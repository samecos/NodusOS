# 详细架构设计

## 一、模块接口契约

以下使用类Rust语法定义接口，强调类型安全和错误处理。`Result<T, E>` 表示成功返回T或失败返回E。

---

### 1. Nodus Shell

```rust
/// Shell是应用的根模块，负责生命周期、模块注册、事件路由。
trait Shell {
    /// 启动系统。依次初始化所有模块，建立事件总线。
    /// 返回Ok当所有模块初始化完成。
    async fn bootstrap(config: NodusConfig) -> Result<(), ShellError>;

    /// 注册一个模块。模块通过Registry暴露自己的接口给其他模块。
    fn register_module<M: Module>(&mut self, name: &str, module: M);

    /// 获取已注册的模块引用。模块间依赖通过此方法解析。
    /// 返回Arc智能指针，调用者持有引用计数，不受Shell生命周期限制。
    fn get_module<M: Module + ?Sized>(&self, name: &str) -> Option<Arc<M>>;

    /// 发布全局事件。订阅者通过EventBus接收。
    fn emit(&self, event: Event);

    /// 订阅特定事件类型。
    fn on<E: EventType>(&self, handler: Box<dyn Fn(E)>) -> Subscription;

    /// 优雅关闭。依次通知各模块清理资源。
    async fn shutdown(&mut self) -> Result<(), ShellError>;
}

enum ShellError {
    ModuleInitFailed { module: String, reason: String },
    ConfigInvalid { field: String, reason: String },
    AlreadyRunning,
    ShutdownTimeout { module: String },
}
```

---

### 2. Intent Engine

```rust
trait IntentEngine {
    /// 解析自然语言文本为结构化查询意图。
    /// context来自ContextManager，提供当前光标/选中/文件等隐式参数。
    ///
    /// 同步调用，延迟目标：< 200ms（本地小模型推理，不涉及网络I/O）。
    fn parse(
        &self,
        input: IntentInput,
        context: &Context,
    ) -> Result<QueryIntent, IntentError>;

    /// 当parse返回Ambiguous时，用户选择后调用此方法补全意图。
    fn resolve_ambiguity(
        &self,
        candidates: Vec<QueryIntent>,
        chosen_index: usize,
    ) -> QueryIntent;

    /// 记录用户反馈，用于优化意图分类模型。
    /// input是原始输入；parsed是parse的返回（Unparseable时为None）；
    /// actual是用户最终实际执行的意图（通过后续行为推断或显式纠正）。
    fn record_feedback(
        &self,
        input: &IntentInput,
        parsed: Option<&QueryIntent>,
        actual: &QueryIntent,
    );
}

struct IntentInput {
    source: InputSource,
    text: String,         // 已转写的文本（语音路径）或原始输入（文字路径）
    locale: String,       // zh-CN | en-US
}

enum InputSource {
    Voice,                // 语音唤醒后输入
    Text,                 // Ctrl+Space 唤起输入条
    ContextMenu,          // 右键菜单触发
}
```

struct Context {
    active_file: Option<String>,
    cursor_line: Option<u32>,
    cursor_col: Option<u32>,
    cursor_symbol: Option<String>,    // 光标所在符号名
    selected_code: Option<String>,    // 选中的代码文本
    selected_range: Option<(u32, u32)>, // 选中的行列范围
    recent_queries: Vec<RecentQuery>,  // 最近5条查询
    active_project_root: String,
}

struct RecentQuery {
    text: String,
    intent_type: IntentType,
    timestamp: DateTime,
}

enum IntentError {
    /// 输入为空或只含唤醒词
    EmptyInput,

    /// 无法理解意图，置信度低于最低阈值
    Unparseable { raw_text: String, reason: String },

    /// 多个候选意图，需要用户选择
    Ambiguous { candidates: Vec<QueryIntent> },

    /// 意图类型超出当前支持范围（如"帮我生成代码"在MVP中不支持）
    UnsupportedIntent { intent_type: String, message: String },
}
```

**辅助类型**：

```rust
/// 意图中的实体参数。IntentEngine从自然语言中提取。
struct IntentEntity {
    symbol_name: Option<String>,
    file_path: Option<String>,
    module_name: Option<String>,
    time_range: Option<TimeRange>,
    author: Option<String>,
}

/// QueryIntent中的entities字段使用此类型。
/// 后续文档中引用QueryIntent.entities即为此类型。

struct TimeRange {
    from: DateTime,
    to: DateTime,
}

/// IntentEngine的parse方法返回此结构体。
struct QueryIntent {
    raw_text: String,
    intent_type: IntentType,
    confidence: f32,           // 0.0 - 1.0
    entities: IntentEntity,
    context_snapshot: Context,
    /// 歧义时的候选意图（处理前为None）
    candidates: Option<Vec<QueryIntent>>,
}

type IntentType = crate::IntentType;  // 定义见 CodeIntelligence 使用的枚举
```

```rust
enum IntentType {
    FindDefinition,
    FindReferences,
    CallGraph,
    ImpactAnalysis,
    ChangeHistory,
    SymbolOverview,
}
```

---

### 3. Context Manager

```rust
trait ContextManager {
    /// 获取当前完整上下文快照。
    /// 高频调用（每次意图解析前调用），需保证 < 1ms。
    fn snapshot(&self) -> Context;

    /// 更新上下文中的某个字段。
    /// UI层在用户切换文件、移动光标、选中代码时调用。
    /// 内部通过事件总线发布 ContextChanged 事件。
    fn update(&mut self, delta: ContextDelta);
}

enum ContextDelta {
    FileOpened { path: String },
    FileClosed { path: String },
    CursorMoved { file: String, line: u32, col: u32, symbol: Option<String> },
    SelectionChanged { file: String, range: (u32, u32), code: String },
    ProjectChanged { root: String },
}

// 上下文变更统一通过事件总线发布：
// Event::ContextChanged { delta: ContextDelta }
// 需要监听上下文变化的模块（如Code Intelligence预加载索引）订阅此事件。
```

---

### 3b. File Watcher

FileWatcher监听文件系统变更，将事件发布到事件总线，供Code Intelligence消费以触发增量索引。

```rust
trait FileWatcher {
    /// 开始监听指定目录下的文件变更。
    /// patterns为glob模式，如 ["**/*.ts","**/*.tsx","**/*.py"]。
    fn watch(
        &self,
        path: &Path,
        patterns: &[&str],
    ) -> Result<(), WatchError>;

    /// 停止监听指定目录。
    fn unwatch(&self, path: &Path) -> Result<(), WatchError>;

    /// 暂停监听（用户不希望被索引变更打扰时）。
    fn pause(&self);

    /// 恢复监听。
    fn resume(&self);
}

enum WatchError {
    PathNotFound { path: String },
    TooManyFiles { path: String, count: u32 },
    SystemWatcherError { reason: String },
}

// FileWatcher 发出的事件：
// - Event::FileChanged { path, change_type }
// - Event::FileCreated { path }
// - Event::FileDeleted { path }
```

---

### 4. Code Intelligence

这是最复杂的模块。拆分为子接口：

```rust
trait CodeIntelligence {
    /// ----------------- 索引管理 -----------------

    /// 全量索引一个项目。首次打开项目时调用。
    /// 大项目可能耗时数秒到数十秒。异步执行，通过事件报告进度。
    async fn index_project(
        &self,
        project_root: &Path,
        languages: &[Language],
    ) -> Result<IndexReport, CodeIntelError>;

    /// 增量索引单个文件。文件变更时由FileWatcher触发。
    /// 内部执行：重新解析 → 更新符号 → 更新引用 → 重建该文件相关的调用图边。
    /// 调用图重建是此方法的内在步骤，不做会导致跨文件引用不一致。
    async fn index_file(
        &self,
        file_path: &Path,
    ) -> Result<FileIndexResult, CodeIntelError>;

    /// 获取索引状态。
    fn index_status(&self) -> IndexStatus;

    /// ----------------- 查询接口 -----------------

    /// 查找符号定义。支持模糊名称匹配。
    async fn find_symbol(
        &self,
        name: &str,
        kind: Option<SymbolKind>,
        file_filter: Option<&Path>,
        limit: u32,
    ) -> Result<Vec<Symbol>, CodeIntelError>;

    /// 查找符号的所有引用位置。
    async fn find_references(
        &self,
        symbol_id: &SymbolId,
    ) -> Result<Vec<Reference>, CodeIntelError>;

    /// 获取调用图。
    /// direction: "callers" = 谁调用了它, "callees" = 它调用了谁, "both"
    async fn call_graph(
        &self,
        symbol_id: &SymbolId,
        direction: CallDirection,
        max_depth: u32,
    ) -> Result<CallGraph, CodeIntelError>;

    /// 获取文件中的所有符号（概览）。
    async fn symbols_in_file(
        &self,
        file_path: &Path,
    ) -> Result<Vec<Symbol>, CodeIntelError>;

    /// 影响分析：修改该符号会影响哪些其他符号/文件。
    async fn impact_analysis(
        &self,
        symbol_id: &SymbolId,
    ) -> Result<ImpactReport, CodeIntelError>;

    /// 统一的查询入口。根据QueryIntent自动路由到上述具体方法。
    async fn query(
        &self,
        intent: &QueryIntent,
    ) -> Result<QueryResult, CodeIntelError>;

    /// ----------------- 变更历史（依赖Git Intelligence） -----------------

    /// 查询特定模块或文件的变更历史。
    /// git参数用于查询git log，Code Intelligence负责将commit信息与符号关联。
    /// 跨模块依赖通过显式参数注入，避免隐式耦合。
    async fn change_history(
        &self,
        scope: ChangeScope,
        time_range: Option<TimeRange>,
        git: &dyn GitIntelligence,
    ) -> Result<Vec<ChangeRecord>, CodeIntelError>;
}

/// 统一的查询结果枚举。CodeIntelligence::query根据QueryIntent::intent_type
/// 路由到对应方法后，将结果包装为对应的变体返回。
enum QueryResult {
    SymbolList(Vec<Symbol>),
    ReferenceList(Vec<Reference>),
    CallGraph(CallGraph),
    ImpactReport(ImpactReport),
    ChangeHistory(Vec<ChangeRecord>),
    SymbolOverview(Vec<Symbol>),
}

enum CodeIntelError {
    ParseError { file: String, line: u32, message: String },
    SymbolNotFound { name: String },
    IndexNotReady { progress: f32 },
    UnsupportedLanguage { language: String },
    QueryError { reason: String },
    ProjectNotIndexed { path: String },
}

struct IndexReport {
    files_indexed: u32,
    files_failed: u32,
    symbols_found: u32,
    references_found: u32,
    duration_ms: u64,
    errors: Vec<(String, String)>,  // (file, error_message)
}

struct FileIndexResult {
    symbols_added: u32,
    symbols_removed: u32,
    references_updated: u32,
    duration_ms: u64,
}

enum IndexStatus {
    Idle,
    Scanning { files_found: u32 },
    Indexing { progress: f32, current_file: String },
    Ready { symbol_count: u32, last_indexed: DateTime },
    Updating { progress: f32, changed_files: u32 },
    Error { message: String, recoverable: bool },
}

struct ImpactReport {
    symbol: Symbol,
    direct_callers: Vec<Symbol>,
    transitive_callers: Vec<Symbol>,
    affected_files: Vec<String>,
    risk_level: RiskLevel,
}

enum RiskLevel { Low, Medium, High }

struct ChangeRecord {
    commit_hash: String,
    commit_message: String,
    author: String,
    timestamp: DateTime,
    changed_symbols: Vec<Symbol>,
    diff_summary: String,
}

enum ChangeScope {
    File(String),
    Directory(String),
    Symbol(SymbolId),
}
```

**LanguageParser插件接口**：

```rust
trait LanguageParser: Send + Sync {
    /// 解析器支持的语言标识
    fn language(&self) -> Language;

    /// 支持的文件扩展名
    fn file_extensions(&self) -> &[&str];

    /// 解析源文件，返回AST。
    fn parse(&self, source: &str, file_path: &Path) -> Result<Ast, ParseError>;

    /// 从AST提取所有符号定义。
    fn extract_symbols(&self, ast: &Ast, file_path: &Path) -> Vec<Symbol>;

    /// 提取符号间的引用关系。
    fn extract_references(&self, ast: &Ast, symbols: &[Symbol]) -> Vec<Reference>;

    /// 构建调用图边（哪些符号之间的调用关系）。
    fn extract_call_edges(&self, ast: &Ast, symbols: &[Symbol]) -> Vec<CallEdge>;
}

struct CallEdge {
    caller_name: String,
    callee_name: String,
    location: SourceLocation,
}

struct ParseError {
    message: String,
    line: u32,
    col: u32,
}

enum Language {
    TypeScript,
    JavaScript,
    Python,
}

/// 符号全局唯一标识符。即Symbol.id的类型。
type SymbolId = String;
```

---

### 5. Environment Manager

```rust
trait EnvironmentManager {
    /// 检测项目：扫描目录识别语言、框架、依赖文件。
    async fn detect_project(
        &self,
        path: &Path,
    ) -> Result<ProjectMeta, EnvError>;

    /// 检查指定运行时是否已安装，版本是否满足要求。
    /// required_version使用semver范围表达式（如">=18.0.0", "~3.12"），
    /// 实现层使用semver crate的VersionReq类型。
    async fn check_runtime(
        &self,
        language: Language,
        required_version: &str,
    ) -> RuntimeStatus;

    /// 安装或更新运行时到所需版本。
    async fn install_runtime(
        &self,
        language: Language,
        version: &str,
    ) -> Result<(), EnvError>;

    /// 安装项目依赖。
    async fn install_dependencies(
        &self,
        project: &ProjectMeta,
    ) -> Result<DepInstallReport, EnvError>;

    /// 获取当前环境完整状态。
    fn status(&self) -> EnvStatus;

    /// 获取已知的包管理器列表。
    fn detect_package_manager(&self, path: &Path) -> Option<PackageManager>;
}

enum EnvError {
    UnsupportedLanguage { language: String, supported: Vec<String> },
    RuntimeInstallFailed { language: String, version: String, reason: String },
    DependencyInstallFailed { package_manager: String, reason: String },
    NetworkError { message: String },
    PermissionDenied { path: String },
    UnknownProjectType { path: String },
}

enum RuntimeStatus {
    Installed { version: Version, path: String },
    NotInstalled { required: Version },
    Outdated { current: Version, required: Version },
}

struct ProjectMeta {
    name: String,
    root_path: String,
    languages: Vec<Language>,
    runtimes: Vec<RuntimeRequirement>,
    package_manager: Option<PackageManager>,
    dependencies: Vec<Dependency>,
    framework: Option<Framework>,
}

struct RuntimeRequirement {
    language: Language,
    constraint: String,        // ">=18.0.0" | "~3.12"
    specified_in: String,      // "package.json" | "pyproject.toml"
}

struct Dependency {
    name: String,
    version: String,
    dep_type: DependencyType,  // Production | Development | Peer | Optional
    language: Language,
}

enum DependencyType { Production, Development, Peer, Optional }

enum PackageManager {
    Npm, Yarn, Pnpm,         // JavaScript
    Pip, Poetry, Uv,         // Python
}

enum Framework {
    // JS/TS
    React, NextJs, Vue, Svelte, Express, Hono, NestJs,
    // Python
    FastApi, Flask, Django,
}

struct DepInstallReport {
    packages_installed: u32,
    packages_cached: u32,
    duration_ms: u64,
    warnings: Vec<String>,
}

enum EnvStatus {
    Detecting,
    RuntimeMissing { language: Language, needed: Version },
    InstallingRuntime { language: Language, progress: f32 },
    InstallingDeps { progress: f32, current: String },
    Ready { meta: ProjectMeta },
    Error { message: String },
}
```

---

### 6. Git Intelligence

```rust
trait GitIntelligence {
    /// 查询变更日志。
    async fn log(
        &self,
        repo_path: &Path,
        scope: &ChangeScope,
        time_range: Option<TimeRange>,
        author: Option<&str>,
        max_commits: u32,
    ) -> Result<Vec<CommitInfo>, GitError>;

    /// 获取某次提交的详细diff。
    async fn diff(
        &self,
        repo_path: &Path,
        commit_hash: &str,
    ) -> Result<DiffData, GitError>;

    /// 查看文件的blame信息。
    async fn blame(
        &self,
        repo_path: &Path,
        file_path: &Path,
        line: u32,
    ) -> Result<BlameInfo, GitError>;

    /// 获取两个提交之间变更的符号列表（与Code Intelligence协作）。
    async fn changed_symbols_between(
        &self,
        repo_path: &Path,
        from: &str,
        to: &str,
    ) -> Result<Vec<SymbolId>, GitError>;
}

enum GitError {
    NotAGitRepo { path: String },
    CommitNotFound { hash: String },
    FileNotTracked { path: String },
    GitCommandFailed { command: String, stderr: String },
}

struct CommitInfo {
    hash: String,
    short_hash: String,
    message: String,
    author: String,
    timestamp: DateTime,
    files_changed: u32,
    insertions: u32,
    deletions: u32,
    changed_file_list: Vec<String>,
}

struct DiffData {
    files: Vec<FileDiff>,
    stats: DiffStats,
}

struct FileDiff {
    path: String,
    change_type: DiffChangeType,  // Added | Modified | Deleted | Renamed
    hunks: Vec<DiffHunk>,
}

struct DiffHunk {
    old_start: u32,
    old_lines: u32,
    new_start: u32,
    new_lines: u32,
    lines: Vec<DiffLine>,
}

enum DiffLineType { Added, Removed, Context }

struct DiffLine {
    line_type: DiffLineType,
    content: String,
    old_line: Option<u32>,
    new_line: Option<u32>,
}

struct DiffStats {
    files_changed: u32,
    insertions: u32,
    deletions: u32,
}

struct BlameInfo {
    commit_hash: String,
    author: String,
    timestamp: DateTime,
    summary: String,
    line_content: String,
}
```

---

### 7. UI Renderer

```rust
trait UIRenderer {
    /// 显示一张结果卡片。
    fn show_card(&self, card: Card);

    /// 更新已有卡片的内容。
    fn update_card(&self, card_id: &str, data: CardData);

    /// 消散（关闭）一张卡片。支持动画过渡。
    fn dismiss_card(&self, card_id: &str, animated: bool);

    /// 消散所有与某个意图关联的卡片。
    fn dismiss_intent_cards(&self, intent_id: &str);

    /// 在代码查看器中打开文件并跳转到指定行。
    fn navigate_to_code(&self, file: &Path, line: Option<u32>, highlight: Option<(u32, u32)>);

    /// 唤起意图输入条（文字模式）。
    fn show_input_bar(&self, prefilled_text: Option<&str>);

    /// 更新呼吸灯状态。
    fn set_breath(&self, state: BreathState);

    /// 显示系统通知（低打扰）。
    fn notify(&self, notification: Notification);
}

/// 卡片数据类型的并集。等于Card.data的类型。
type CardData = Box<dyn std::any::Any + Send + Sync>;
// 具体变体的数据定义见 06-architecture.md 的数据模型章节。
// UIRenderer根据card.type判断如何downcast。

enum BreathState {
    Off,
    Idle,           // 系统就绪，微弱的静态光
    Listening,      // 正在听，呼吸动画
    Working,        // 正在处理，旋转或脉冲
    Warning,        // 有通知等待查看，变色
}

struct Notification {
    level: NotificationLevel,
    title: String,
    body: String,
    ttl_seconds: u32,
    action: Option<NotificationAction>,
}

enum NotificationLevel {
    Info,
    Warning,
    Critical,
}

struct NotificationAction {
    label: String,           // "查看" "处理" "了解详情"
    callback_id: String,     // 点击后触发的事件ID
}
```

---

### 8. Voice Pipeline

VoicePipeline内部管理完整的语音状态机：
```
静默监听 → 唤醒词检测 → 录音 → (VAD/超时) → 转写 → 发出VoiceTranscribed事件
```

对外只暴露启动/停止和模式切换。内部细节通过事件总线通知其他模块。

```rust
trait VoicePipeline {
    /// 启动语音管线（包括后台唤醒词监听）。
    /// 检测到唤醒词后自动完成 record → transcribe 链路，
    /// 最终发出 Event::VoiceTranscribed。
    async fn start(&self);

    /// 停止语音管线。进入无声模式时调用。
    async fn stop(&self);

    /// 文字转语音并播放。用于系统语音回应。
    async fn speak(&self, text: &str) -> Result<(), VoiceError>;

    /// 当前麦克风是否可用。
    fn microphone_available(&self) -> bool;

    /// 进入/退出无声模式。
    /// 无声模式下停止唤醒词监听，仅接受文字输入。
    /// start/stop由此方法内部管理，调用者无需单独调用。
    fn set_silent_mode(&self, silent: bool);
}

// VoicePipeline内部发出的事件：
// - VoiceWakeDetected    — 检测到唤醒词
// - VoiceListeningStarted — 开始录音
// - VoiceTranscribed { text } — 转写完成
// - VoiceError { error } — 语音处理错误
// - SilentModeToggled { silent } — 模式切换

enum VoiceError {
    NoMicrophone,
    PermissionDenied,
    WakeWordTimeout,
    TranscriptionFailed { reason: String },
    SynthesisFailed { reason: String },
    DeviceBusy,
}
```

---

### 9. Knowledge Store

```rust
trait KnowledgeStore {
    // ---- 符号操作 ----
    async fn symbols_upsert(&self, symbols: &[Symbol]) -> Result<u32, StoreError>;
    async fn symbols_remove(&self, file_path: &Path) -> Result<u32, StoreError>;
    async fn symbols_find_by_name(&self, name: &str, kind: Option<SymbolKind>, limit: u32) -> Result<Vec<Symbol>, StoreError>;
    async fn symbols_find_by_file(&self, file_path: &Path) -> Result<Vec<Symbol>, StoreError>;
    async fn symbols_find_by_module(&self, module_path: &str) -> Result<Vec<Symbol>, StoreError>;
    async fn symbols_search(&self, query: &str, limit: u32) -> Result<Vec<Symbol>, StoreError>;

    // ---- 引用操作 ----
    async fn refs_upsert(&self, refs: &[Reference]) -> Result<u32, StoreError>;
    async fn refs_remove_for_file(&self, file_path: &Path) -> Result<u32, StoreError>;
    async fn refs_find_by_target(&self, symbol_id: &SymbolId) -> Result<Vec<Reference>, StoreError>;
    async fn refs_find_by_source(&self, symbol_id: &SymbolId) -> Result<Vec<Reference>, StoreError>;

    // ---- 调用图 ----
    /// 存储预计算的调用图（全量索引完成后调用）。
    async fn callgraph_store(&self, graph: &CallGraph) -> Result<(), StoreError>;
    /// 获取调用图。
    async fn callgraph_get(&self, symbol_id: &SymbolId, direction: CallDirection, max_depth: u32) -> Result<CallGraph, StoreError>;
    /// 重建单文件相关的调用图边（增量索引时调用）。
    async fn callgraph_rebuild_for_file(&self, file_path: &Path) -> Result<(), StoreError>;

    // ---- 项目 ----
    async fn project_get(&self, path: &Path) -> Result<Option<ProjectMeta>, StoreError>;
    async fn project_upsert(&self, meta: &ProjectMeta) -> Result<(), StoreError>;
    async fn project_list(&self) -> Result<Vec<ProjectMeta>, StoreError>;

    // ---- 偏好 ----
    async fn pref_get(&self, key: &str) -> Result<Option<serde_json::Value>, StoreError>;
    async fn pref_set(&self, key: &str, value: &serde_json::Value) -> Result<(), StoreError>;
    async fn pref_delete(&self, key: &str) -> Result<(), StoreError>;

    // ---- 查询历史 ----
    async fn history_record(&self, entry: QueryHistoryEntry) -> Result<(), StoreError>;
    async fn history_recent(&self, limit: u32) -> Result<Vec<QueryHistoryEntry>, StoreError>;

    // ---- 生命周期 ----
    async fn vacuum(&self) -> Result<(), StoreError>;
}

struct QueryHistoryEntry {
    raw_text: String,
    intent_type: Option<IntentType>,
    entities: Option<IntentEntity>,
    context_file: Option<String>,
    context_symbol: Option<String>,
    confidence: Option<f32>,
    latency_ms: u64,
    result_count: u32,
}

enum StoreError {
    ConnectionError { reason: String },
    QueryError { reason: String },
    MigrationError { reason: String },
    SerializationError { reason: String },
}
```

---


### 10. ChangeSensor（变更传感器）

```typescript
export interface ChangeSensor {
  start(projectRoot: string): void;
  stop(): void;
  onBatch(handler: (batch: ChangeBatch) => void): () => void;
  detect(projectRoot: string): Promise<ChangeBatch | null>;
}
```

**ChangeBatch**：`{ id, project_root, detected_at, files[], symbols: ChangedSymbol[], snapshot: Record<string,string> }`

### 11. DebtEngine（理解债引擎）

```typescript
export interface DebtEngine {
  recompute(batch: ChangeBatch): Promise<void>;
  getTopDebt(limit: number): DebtQueryResult[];
  getDebtByFile(filePath: string): DebtQueryResult[];
  markExamined(symbolId: string): void;
  confirmReviewed(symbolId: string): void;
  decay(): number;
}
```

### 12. SemanticChunker（语义切片器）

```typescript
export interface SemanticChunker {
  chunk(batch: ChangeBatch): SemanticChunk[];
  brief(chunk: SemanticChunk, batch: ChangeBatch): BriefCard;
}
```

### 13. AlignmentFlywheel（对齐飞轮）

```typescript
export interface AlignmentFlywheel {
  capture(input: CorrectionCapture): void;
  emitConventions(projectRoot: string): void;
  listConventions(): Convention[];
  prune(tag: string): boolean;
}
```

### 14. AnnotatedView（带标注代码视图·P1 纯函数）

```typescript
function renderAnnotatedView(
  filePath: string,
  code: string,
  debts: DebtQueryResult[],
  briefs: BriefCard[],
): string;
```


## 二、数据库Schema

SQLite数据库 `nodus.db`。存储于 `~/.nodus/` 目录下。

```sql
-- 符号表
CREATE TABLE symbols (
    id TEXT PRIMARY KEY,                    -- hash(path + name + kind + location)
    name TEXT NOT NULL,
    kind TEXT NOT NULL,                     -- function|method|class|interface|type|variable|parameter|module
    language TEXT NOT NULL,                 -- typescript|javascript|python
    file_path TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    col_start INTEGER NOT NULL,
    col_end INTEGER NOT NULL,
    parent_id TEXT,                         -- 父符号ID（类的方法→类）
    is_exported INTEGER NOT NULL DEFAULT 0,
    signature TEXT,                         -- 函数/类型签名
    doc_comment TEXT,                       -- 文档注释截断至512字符
    file_checksum TEXT NOT NULL,            -- 文件内容哈希，用于检测变更
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 引用关系表
CREATE TABLE references (
    id TEXT PRIMARY KEY,                    -- hash(source + target + location)
    source_symbol_id TEXT NOT NULL,         -- 谁引用了
    target_symbol_id TEXT NOT NULL,         -- 被谁引用
    file_path TEXT NOT NULL,                -- 引用发生的位置
    line INTEGER NOT NULL,
    col INTEGER NOT NULL,
    kind TEXT NOT NULL,                     -- call|import|inheritance|type_use|instantiation|override
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 文件索引状态表
CREATE TABLE file_index_state (
    file_path TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,                 -- 当前已索引的文件内容哈希
    symbol_count INTEGER NOT NULL DEFAULT 0,
    indexed_at TEXT NOT NULL,
    error TEXT                              -- 索引失败时的错误信息，NULL表示成功
);

-- 项目表
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    languages TEXT NOT NULL,                -- JSON数组: ["typescript","python"]
    framework TEXT,                         -- JSON可空
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 项目运行时配置表
CREATE TABLE project_runtimes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    version_constraint TEXT NOT NULL,       -- ">=18.0.0"
    installed_version TEXT,
    specified_in TEXT,                      -- "package.json" engines字段
    UNIQUE(project_id, language)
);

-- 项目依赖表
CREATE TABLE project_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    dep_type TEXT NOT NULL,                 -- production|development|peer|optional
    language TEXT NOT NULL,
    UNIQUE(project_id, name, dep_type)
);

-- 用户偏好表（KV存储）
CREATE TABLE user_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,                    -- JSON
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 查询历史表
CREATE TABLE query_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_text TEXT NOT NULL,
    intent_type TEXT,
    entities TEXT,                          -- JSON
    context_file TEXT,
    context_symbol TEXT,
    confidence REAL,
    latency_ms INTEGER,
    result_count INTEGER,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
### 理解债表 `debt_entries` (v4)

```sql
CREATE TABLE debt_entries (
    symbol_id      TEXT PRIMARY KEY,
    file_path      TEXT NOT NULL,
    debt           REAL NOT NULL,
    change_recency REAL NOT NULL,
    difficulty     REAL NOT NULL,
    examined_at    INTEGER,
    confirmed_at   INTEGER,
    updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_debt_file ON debt_entries(file_path);
CREATE INDEX idx_debt_value ON debt_entries(debt DESC);
```

### 代码修正标注表 `code_annotations` (v5)

```sql
CREATE TABLE code_annotations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ai_generated_code   TEXT NOT NULL,
    human_modified_code TEXT NOT NULL,
    diff                TEXT NOT NULL,
    symbols_involved    TEXT,
    annotation_tags     TEXT,
    chunk_id            TEXT,
    brief_field_hits    TEXT,
    action              TEXT NOT NULL,
    debt_at_review      REAL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_code_anno_tags ON code_annotations(annotation_tags);
CREATE INDEX idx_code_anno_symbol ON code_annotations(symbols_involved);
```

### 约定模式表 `conventions` (v6)

```sql
CREATE TABLE conventions (
    tag             TEXT PRIMARY KEY,
    pattern_desc    TEXT NOT NULL,
    occurrences     INTEGER NOT NULL DEFAULT 0,
    symbol_examples TEXT,
    last_seen       INTEGER NOT NULL
);
```



-- 训练标注表（v2，此处预定义）
CREATE TABLE annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ai_generated_code TEXT NOT NULL,
    human_modified_code TEXT NOT NULL,
    diff TEXT NOT NULL,
    symbols_involved TEXT,                  -- JSON: 涉及的符号
    annotation_tags TEXT,                   -- JSON: ["add_null_check","add_audit_log"]
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**索引策略**：

```sql
-- 符号表索引
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_file ON symbols(file_path);
CREATE INDEX idx_symbols_kind ON symbols(kind);
CREATE INDEX idx_symbols_language ON symbols(language);
CREATE INDEX idx_symbols_parent ON symbols(parent_id);
CREATE INDEX idx_symbols_module ON symbols(file_path, kind);  -- 按文件+种类查询

-- 引用表索引
CREATE INDEX idx_refs_target ON references(target_symbol_id);
CREATE INDEX idx_refs_source ON references(source_symbol_id);
CREATE INDEX idx_refs_file ON references(file_path);
CREATE INDEX idx_refs_kind ON references(kind);

-- 文件状态索引
CREATE INDEX idx_file_state_checksum ON file_index_state(checksum);

-- 查询历史索引
CREATE INDEX idx_query_history_timestamp ON query_history(timestamp);
CREATE INDEX idx_query_history_intent ON query_history(intent_type);
```

---

## 三、事件总线

### 事件定义

```rust
enum Event {
    // ---- 项目生命周期 ----
    ProjectOpened { root: String, meta: ProjectMeta },
    ProjectClosed { root: String },

    // ---- 环境生命周期 ----
    EnvDetecting { root: String },
    EnvRuntimeMissing { language: Language, needed: String },
    EnvInstallingRuntime { language: Language, progress: f32 },
    EnvInstallingDeps { progress: f32, current_package: String },
    EnvReady { meta: ProjectMeta },
    EnvError { message: String, recoverable: bool },

    // ---- 索引生命周期 ----
    IndexStarted { total_files: u32 },
    IndexProgress { current: u32, total: u32, current_file: String },
    IndexFileDone { file: String, symbols: u32 },
    IndexReady { symbol_count: u32, duration_ms: u64 },
    IndexError { message: String, file: Option<String> },

    // ---- 文件变更 ----
    FileChanged { path: String, change_type: ChangeType },
    FileCreated { path: String },
    FileDeleted { path: String },

    // ---- 上下文变更（替代独立的观察者模式） ----
    ContextChanged { delta: ContextDelta },

    // ---- 查询 ----
    QueryStarted { intent: QueryIntent },
    QueryCompleted { intent: QueryIntent, result_count: u32, latency_ms: u64 },
    QueryError { intent: QueryIntent, error: String },

    // ---- 语音 ----
    VoiceWakeDetected,
    VoiceListeningStarted,
    VoiceTranscribed { text: String },
    VoiceError { error: VoiceError },

    // ---- UI ----
    CardShown { card_id: String, card_type: CardType },
    CardDismissed { card_id: String },
    CardInteracted { card_id: String, action: String },
    InputBarFocused { source: InputSource },
    SilentModeToggled { silent: bool },

    // ---- 系统 ----
    SystemShutdown,
    SystemError { message: String, fatal: bool },
}

enum ChangeType {
    Created,
    Modified,
    Deleted,
    Renamed,
}
```

### 事件订阅路由

事件处理器中，同步操作直接执行。异步操作通过 `spawn` 派发到 runtime 执行，
避免阻塞事件总线。

```rust
// Shell启动时建立的事件路由表：

// EnvReady → 触发异步索引（spawn到后台）
event_bus.on::<EnvReady>(|e| {
    let ci = code_intelligence.clone();
    let root = e.meta.root_path.clone();
    let languages = e.meta.languages.clone();
    tokio::spawn(async move {
        let _ = ci.index_project(&root, &languages).await;
    });
});

// FileChanged → 增量索引（spawn到后台）
event_bus.on::<FileChanged>(|e| {
    if e.change_type == ChangeType::Modified || e.change_type == ChangeType::Created {
        let ci = code_intelligence.clone();
        let path = e.path.clone();
        tokio::spawn(async move {
            let _ = ci.index_file(&path).await;
        });
    } else if e.change_type == ChangeType::Deleted {
        let ks = knowledge_store.clone();
        let path = std::path::PathBuf::from(&e.path);
        tokio::spawn(async move {
            let _ = ks.symbols_remove(&path).await;
        });
    }
});

// VoiceWakeDetected → VoicePipeline内部自动开始录音+转写（模块自身管理状态机）
event_bus.on::<VoiceWakeDetected>(|_| {
    // VoicePipeline在检测到唤醒词后自动完成 record → transcribe 链，
    // 最终发出 VoiceTranscribed 事件。此事件只用于UI响应（呼吸灯变化）。
    ui_renderer.set_breath(BreathState::Listening);
});

// VoiceTranscribed → 意图解析（sync，不阻塞）→ 异步查询（spawn）
event_bus.on::<VoiceTranscribed>(|e| {
    let context = context_manager.snapshot();
    match intent_engine.parse(
        IntentInput { source: InputSource::Voice, text: e.text.clone(), locale: "zh-CN".into() },
        &context,
    ) {
        Ok(intent) => {
            let ci = code_intelligence.clone();
            let ui = ui_renderer.clone();
            let ks = knowledge_store.clone();
            tokio::spawn(async move {
                match ci.query(&intent).await {
                    Ok(result) => {
                        let card = Card::from(result);
                        ui.show_card(card);
                        shell.emit(Event::QueryCompleted { intent, result_count: 1, latency_ms: 0 });
                        let _ = ks.history_record(QueryHistoryEntry::from(&intent)).await;
                    }
                    Err(e) => {
                        shell.emit(Event::QueryError { intent, error: format!("{:?}", e) });
                    }
                }
            });
        }
        Err(IntentError::Ambiguous { candidates }) => {
            ui_renderer.show_card(Card::ambiguity(candidates));
        }
        Err(e) => {
            ui_renderer.notify(Notification {
                level: NotificationLevel::Warning,
                title: "未能理解".into(),
                body: format!("{:?}", e),
                ttl_seconds: 5,
                action: None,
            });
        }
    }
});

// QueryCompleted → 记录历史（不需要额外处理，已在上面完成）
```

---

## 四、核心状态机

### 4.1 项目生命周期

```
                    ┌─────────┐
                    │  Closed │
                    └────┬────┘
                         │ open project
                         ▼
                    ┌──────────┐
                    │ Detecting│
                    └────┬─────┘
                         │ project recognized
                         ▼
              ┌──────────────────────┐
              │  Checking Environment│
              └──────┬───────────────┘
                     │
            ┌────────┼────────┐
            ▼        ▼        ▼
       ┌────────┐ ┌──────┐ ┌──────────┐
       │  Ready │ │Install│ │ Error    │──→ 显示降级信息
       └───┬────┘ │Runtime│ │(可恢复)  │    提供手动修复入口
           │      └──┬───┘ └──────────┘
           │         │ installed
           │         ▼
           │    ┌──────────┐
           │    │Install   │
           │    │Deps      │
           │    └────┬─────┘
           │         │ installed
           │         ▼
           └────┌─────────┐
                │ Indexing │────────→ IndexError → 重试或跳过
                └────┬─────┘
                     │ indexing complete
                     ▼
                ┌─────────┐
                │  Ready  │ ←→ 文件变更 → Updating → Ready
                └─────────┘     (增量)     (短暂状态)
```

### 4.2 索引生命周期

```
     ┌──────┐
     │ Idle │
     └──┬───┘
        │ index_project() or index_file() called
        ▼
     ┌─────────┐
     │ Scanning│ ──→ 遍历文件树，过滤出支持的源文件
     └────┬────┘
          │ files found
          ▼
     ┌──────────┐
     │ Indexing  │ ←──────────────┐
     └────┬─────┘                │
          │                      │ 下一个文件
          │  per file:           │
          │  parse → extract     │
          │  → upsert symbols    │
          │  → upsert refs       │
          │                      │
          ▼                      │
     ┌──────────┐                │
     │ Building  │                │
     │ CallGraph │                │
     └────┬─────┘                │
          │                      │
          ▼                      │
     ┌─────────┐    file change   │
     │  Ready  │ ────────────────┘
     └─────────┘    (增量更新单文件)
```

### 4.3 意图解析状态机

```
     ┌──────┐
     │ Idle │
     └──┬───┘
        │ wake word / Ctrl+Space
        ▼
     ┌──────────┐
     │ Listening │ (voice) or InputShown (text)
     └────┬─────┘
          │ input received
          ▼
     ┌──────────┐
     │ Parsing  │
     └────┬─────┘
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
┌──────┐ ┌────┐ ┌───────────┐
│Parsed│ │Ambi│ │Unparseable│
│conf> │ │guous│ │ or Empty │
│0.8   │ └──┬─┘ └─────┬─────┘
└──┬───┘    │show       │ show error /
   │        │options    │ ask to rephrase
   ▼        ▼           ▼
┌──────┐ ┌──────┐  ┌──────────┐
│Query │ │User  │  │ Back to  │
│      │ │Selects│  │ Listening │
└──┬───┘ └──┬───┘  └──────────┘
   │        │ intent resolved
   │        ▼
   │    ┌──────────┐
   └───▶│ Querying │
        └────┬─────┘
             │ result ready
             ▼
        ┌──────────┐
        │ Showing  │ → card displayed
        │ Result   │
        └──────────┘
             │ user dismisses or TTL expires
             ▼
        ┌──────────┐
        │  Idle    │ (back to start)
        └──────────┘
```

---

## 五、错误处理策略

### 错误分类

```
Error Severity (三层):

CRITICAL — 系统无法继续工作
  · 数据库损坏无法恢复
  · 磁盘空间耗尽
  · 行为：显示紧急通知，引导用户处理，部分功能降级

RECOVERABLE — 当前操作失败但不影响整体
  · 某个文件解析失败（编码问题/语法错误）
  · 网络不通导致依赖安装失败
  · 行为：跳过失败项，记录错误，展示降级信息，用户可重试

TRANSIENT — 暂时性问题，自动重试
  · 语音识别超时（环境噪音）
  · git操作超时
  · 行为：自动重试2-3次，失败后升级为RECOVERABLE
```

### 错误传播规则

```
Layer N+1                              Layer N
─────────                              ───────
    │                                      │
    │  调用 layer N 的方法                  │
    │──────────────────────────────────▶   │
    │                                      │
    │  返回 Result<T, ErrorX>              │
    │◀──────────────────────────────────   │
    │                                      │
    ├─ Ok → 继续处理                        │
    │                                      │
    ├─ Recovable → 转换为本层错误            │
    │   记录日志                            │
    │   向用户展示降级信息                    │
    │                                      │
    └─ Critical → 向上传播                  │
        通过事件总线发出 SystemError         │
```

**每层转换规则**：
- Intent Engine永远不返回Critical（意图理解失败是正常的）
- Code Intelligence返回Recoverable为主（单个文件解析失败不影响整体）
- Environment Manager可能返回Critical（磁盘满）
- Knowledge Store可能返回Critical（数据库损坏）

### 务实降级清单

| 场景 | 降级策略 |
|------|---------|
| 某个源文件编码错误无法解析 | 跳过该文件，索引报告中标明，剩余99%正常查询 |
| 网络不通，依赖安装失败 | 显示缺失的依赖，提供手动安装指令（最低认知负担） |
| 语音识别连续失败3次 | "语音似乎不太方便，我切换到文字输入模式。" |
| Git仓库损坏 | 变更历史查询不可用，其他Code Intelligence功能正常 |
| 项目语言无法识别 | 询问用户："这个项目主要用什么语言？" |
| 调用图过大（>200节点） | 默认展示前3层，提供"展开全部"选项 |

---

## 六、配置Schema

```rust
struct NodusConfig {
    /// 项目根目录列表
    projects: Vec<ProjectEntry>,

    /// 语音配置
    voice: VoiceConfig,

    /// 环境配置
    environment: EnvironmentConfig,

    /// UI配置
    ui: UiConfig,

    /// 模块特定配置
    code_intelligence: CodeIntelConfig,
}

struct ProjectEntry {
    path: String,
    alias: Option<String>,     // 用户自定义简称
    auto_open: bool,           // 启动时是否自动打开
}

struct VoiceConfig {
    enabled: bool,
    wake_word: String,         // 默认 "Nodus"
    language: String,          // "zh-CN" | "en-US"
    silent_mode_default: bool, // 启动时默认是否无声模式
    input_timeout_ms: u64,     // 语音输入超时（默认8000ms）
}

struct EnvironmentConfig {
    /// 各语言的默认包管理器
    default_package_managers: HashMap<Language, PackageManager>,
    /// 网络代理配置
    proxy: Option<ProxyConfig>,
    /// 全局安装路径
    runtime_install_path: Option<String>,
}

struct UiConfig {
    card_default_ttl_secs: u32,   // 卡片默认存活时间（0=手动关闭）
    theme: Theme,                   // Dark | Light | System
    font_size: FontSize,           // Small | Medium | Large
    breath_enabled: bool,          // 是否显示呼吸灯
}

struct CodeIntelConfig {
    /// 排除的文件glob模式
    exclude_patterns: Vec<String>,  // ["**/node_modules/**","**/dist/**","**/.git/**"]
    /// 最大索引文件大小（KB）
    max_file_size_kb: u32,          // 默认 500
    /// 增量索引防抖延迟（ms）
    debounce_ms: u64,               // 默认 500
}
```

---

## 七、系统启动流程

```
Bootstrap Sequence:

1. Shell::bootstrap(config)
   │
   ├── 2. 初始化 KnowledgeStore
   │   ├── 打开/创建 ~/.nodus/nodus.db
   │   ├── 运行迁移
   │   └── 检查完整性
   │
   ├── 3. 初始化各模块（按依赖顺序）
   │   ├── ContextManager（无依赖）
   │   ├── VoicePipeline（无依赖）
   │   ├── EnvironmentManager（无依赖）
   │   ├── GitIntelligence（无依赖）
   │   ├── CodeIntelligence（依赖 KnowledgeStore）
   │   ├── IntentEngine（依赖 ContextManager）
   │   └── UIRenderer（依赖所有模块的接口）
   │
   ├── 4. 注册事件路由
   │   └── 按照第三节的事件订阅表建立订阅
   │
   ├── 5. 恢复上次会话
   │   ├── 从 KnowledgeStore 读取上次打开的项目
   │   ├── 如果 config.projects[].auto_open，自动打开
   │   └── 恢复 ContextManager 状态（上次打开的文件和光标位置）
   │
   ├── 6. 显示 UI
   │   ├── 渲染代码工作区（上次的文件和光标位置）
   │   ├── 呼吸灯 → Idle
   │   └── VoicePipeline 开始后台唤醒词监听
   │
   └── 7. 进入事件循环
       └── 等待用户输入或系统事件
```
