# Nodus API 接口文档 (API Reference)

> 版本: v1.0 | 日期: 2026-05-04

---

## 1. 文档约定

### 1.1 类型表示

本文档使用 Rust 风格的类型表示。接口以 Rust trait 定义，但概念适用于任何实现语言。

```rust
// 通用 Result 类型
Result<T, E>  // 成功返回 T，失败返回 E

// 异步方法标记
async fn ...   // 异步方法，在 tokio runtime 中执行
fn ...         // 同步方法
```

### 1.2 通用类型

```rust
type SymbolId = String;
type DateTime = String;  // ISO 8601 format
type Path = std::path::Path;
type Version = String;   // semver, e.g. "22.5.1"

enum Language { TypeScript, JavaScript, Python }

struct SourceLocation {
    file_path: String,
    line_start: u32, line_end: u32,
    col_start: u32, col_end: u32,
}
```

---

## 2. Nodus Shell

应用根模块。管理生命周期、模块注册和事件总线。

### 2.1 bootstrap

```rust
async fn bootstrap(config: NodusConfig) -> Result<(), ShellError>;
```

初始化并启动系统。

| 参数 | 类型 | 说明 |
|------|------|------|
| `config` | `NodusConfig` | 系统配置，从 `~/.nodus/config.json` 加载 |

| 返回值 | 说明 |
|--------|------|
| `Ok(())` | 系统正常启动 |
| `Err(ShellError)` | 启动失败 |

**错误码**：

| 错误变体 | 说明 |
|---------|------|
| `ConfigInvalid { field, reason }` | 配置文件中某字段无效 |
| `ModuleInitFailed { module, reason }` | 某模块初始化失败 |
| `AlreadyRunning` | Nodus 已在运行 |

**示例**：

```rust
let config = NodusConfig::load()?;
let shell = Shell::bootstrap(config).await?;
```

### 2.2 register_module

```rust
fn register_module<M: Module + ?Sized>(&mut self, name: &str, module: Arc<M>);
```

注册模块到系统中。

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `&str` | 模块名称，如 `"code_intelligence"` |
| `module` | `Arc<M>` | 模块实例（Arc指针） |

### 2.3 get_module

```rust
fn get_module<M: Module + ?Sized>(&self, name: &str) -> Option<Arc<M>>;
```

获取已注册的模块引用。

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `&str` | 模块名称 |

| 返回值 | 说明 |
|--------|------|
| `Some(Arc<M>)` | 模块引用 |
| `None` | 模块未注册 |

**示例**：

```rust
let code_intel: Arc<dyn CodeIntelligence> = shell
    .get_module("code_intelligence")
    .expect("CodeIntelligence not registered");
```

### 2.4 事件总线

```rust
fn emit(&self, event: Event);
fn on<E: EventType>(&self, handler: Box<dyn Fn(E)>) -> Subscription;
```

- `emit`: 发布事件，所有匹配类型的订阅者收到通知
- `on`: 订阅事件，返回 `Subscription`，drop 时自动取消订阅

完整事件列表见第 10 节。

---

## 3. Intent Engine

### 3.1 parse

```rust
fn parse(
    &self,
    input: IntentInput,
    context: &Context,
) -> Result<QueryIntent, IntentError>;
```

解析自然语言为结构化查询意图。MVP 实现采用 **正则精确匹配 + 示例相似度回退** 的混合策略：

1. 先用正则规则快速匹配标准句式（confidence ≥ 0.8 直接返回）。
2. 正则失败时，将输入与一组标准例句做字符 n-gram + 余弦相似度比较，识别同义改写、口语化、轻微错字。
3. 仍无法识别且有光标/选中上下文时，自动补全为 `find_definition`。

**同步方法，延迟 < 200ms。**

| 参数 | 类型 | 说明 |
|------|------|------|
| `input` | `IntentInput` | 用户输入（来源+文本+语言） |
| `context` | `&Context` | 当前上下文快照（文件、光标、选中） |

**IntentInput**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `source` | `InputSource` | Voice / Text / ContextMenu |
| `text` | `String` | 原始输入文本 |
| `locale` | `String` | "zh-CN" / "en-US" |

**返回值**：

| 变体 | 说明 |
|------|------|
| `Ok(QueryIntent)` | 解析成功，confidence ≥ 0.8 |
| `Err(Ambiguous { candidates })` | 歧义，提供候选意图让用户选择 |
| `Err(Unparseable { .. })` | 无法理解 |
| `Err(EmptyInput)` | 输入为空 |
| `Err(UnsupportedIntent { .. })` | 意图类型不在 MVP 支持范围 |

**示例**：

```rust
let input = IntentInput {
    source: InputSource::Voice,
    text: "refundOrder被哪些地方调用了".into(),
    locale: "zh-CN".into(),
};
let context = context_mgr.snapshot();
match intent_engine.parse(input, &context)? {
    Ok(intent) => code_intel.query(&intent).await?,
    Err(IntentError::Ambiguous { candidates }) => {
        ui.show_card(Card::ambiguity(candidates));
    }
    Err(e) => ui.notify_error(e),
}
```

### 3.2 resolve_ambiguity

```rust
fn resolve_ambiguity(
    &self,
    candidates: Vec<QueryIntent>,
    chosen_index: usize,
) -> QueryIntent;
```

用户从歧义选项中选定后，返回确定的意图。

| 参数 | 类型 | 说明 |
|------|------|------|
| `candidates` | `Vec<QueryIntent>` | 候选意图列表 |
| `chosen_index` | `usize` | 用户选择的索引 (0-based) |

### 3.3 record_feedback

```rust
fn record_feedback(
    &self,
    input: &IntentInput,
    parsed: Option<&QueryIntent>,
    actual: &QueryIntent,
);
```

记录用户反馈，用于持续优化意图分类模型。

| 参数 | 类型 | 说明 |
|------|------|------|
| `input` | `&IntentInput` | 原始输入 |
| `parsed` | `Option<&QueryIntent>` | parse 的结果（Unparseable 时为 None） |
| `actual` | `&QueryIntent` | 用户最终执行的意图 |

---

## 4. Context Manager

### 4.1 snapshot

```rust
fn snapshot(&self) -> Context;
```

获取当前上下文快照。高频调用（每次查询前），延迟 < 1ms。

**返回值 Context**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `active_file` | `Option<String>` | 当前查看的文件路径 |
| `cursor_line` | `Option<u32>` | 光标行号 |
| `cursor_col` | `Option<u32>` | 光标列号 |
| `cursor_symbol` | `Option<String>` | 光标所在符号名 |
| `selected_code` | `Option<String>` | 选中的代码文本 |
| `selected_range` | `Option<(u32, u32)>` | 选中的行列范围 |
| `recent_queries` | `Vec<RecentQuery>` | 最近5条查询 |
| `active_project_root` | `String` | 当前项目根路径 |

### 4.2 update

```rust
fn update(&mut self, delta: ContextDelta);
```

更新上下文状态。UI 层在文件切换、光标移动、选中代码时调用。内部通过事件总线发布 `ContextChanged`。

**ContextDelta 变体**：

```rust
enum ContextDelta {
    FileOpened { path: String },
    FileClosed { path: String },
    CursorMoved { file: String, line: u32, col: u32, symbol: Option<String> },
    SelectionChanged { file: String, range: (u32, u32), code: String },
    ProjectChanged { root: String },
}
```

---

## 5. Code Intelligence

### 5.1 index_project

```rust
async fn index_project(
    &self,
    project_root: &Path,
    languages: &[Language],
) -> Result<IndexReport, CodeIntelError>;
```

全量索引一个项目。**异步，耗时 1-30 秒。** 通过事件总线报告进度。

| 参数 | 类型 | 说明 |
|------|------|------|
| `project_root` | `&Path` | 项目根目录 |
| `languages` | `&[Language]` | 要索引的语言列表 |

**返回值 IndexReport**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `files_indexed` | `u32` | 成功索引的文件数 |
| `files_failed` | `u32` | 失败的文件数 |
| `symbols_found` | `u32` | 提取的符号总数 |
| `references_found` | `u32` | 解析的引用总数 |
| `duration_ms` | `u64` | 耗时（毫秒） |
| `errors` | `Vec<(String, String)>` | (文件, 错误信息) 列表 |

### 5.2 index_file

```rust
async fn index_file(
    &self,
    file_path: &Path,
) -> Result<FileIndexResult, CodeIntelError>;
```

增量索引单个文件。内部自动重建该文件相关的调用图边。

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | `&Path` | 变更的文件路径 |

**返回值 FileIndexResult**：

| 字段 | 类型 |
|------|------|
| `symbols_added` | `u32` |
| `symbols_removed` | `u32` |
| `references_updated` | `u32` |
| `duration_ms` | `u64` |

### 5.3 find_symbol

```rust
async fn find_symbol(
    &self,
    name: &str,
    kind: Option<SymbolKind>,
    file_filter: Option<&Path>,
    limit: u32,
) -> Result<Vec<Symbol>, CodeIntelError>;
```

按名称查找符号定义。支持模糊匹配。

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `&str` | 符号名称（支持部分匹配） |
| `kind` | `Option<SymbolKind>` | 按种类过滤 |
| `file_filter` | `Option<&Path>` | 按文件过滤 |
| `limit` | `u32` | 最大返回数 |

**示例**：

```rust
// "getUserByEmail在哪里定义的"
let symbols = code_intel.find_symbol(
    "getUserByEmail", None, None, 10
).await?;
// → [{ name: "getUserByEmail", kind: Function,
//      file: "src/services/user.service.ts", line: 42 }]
```

### 5.4 find_references

```rust
async fn find_references(
    &self,
    symbol_id: &SymbolId,
) -> Result<Vec<Reference>, CodeIntelError>;
```

查找符号的所有引用位置。

**示例**：

```rust
// "refundOrder被哪些地方调用了"
let sym = code_intel.find_symbol("refundOrder", None, None, 1).await?;
let refs = code_intel.find_references(&sym[0].id).await?;
// → 14 条引用，含文件、行号、引用类型
```

### 5.5 call_graph

```rust
async fn call_graph(
    &self,
    symbol_id: &SymbolId,
    direction: CallDirection,  // Callers | Callees | Both
    max_depth: u32,
) -> Result<CallGraph, CodeIntelError>;
```

获取符号的调用图。

| 参数 | 类型 | 说明 |
|------|------|------|
| `symbol_id` | `&SymbolId` | 根符号ID |
| `direction` | `CallDirection` | Callers（被谁调用）/ Callees（调用了谁）/ Both |
| `max_depth` | `u32` | 最大深度（默认3，超过200节点截断） |

**返回值 CallGraph**：

| 字段 | 类型 |
|------|------|
| `root_symbol_id` | `SymbolId` |
| `direction` | `CallDirection` |
| `max_depth` | `u32` |
| `nodes` | `Vec<CallGraphNode>` |
| `edges` | `Vec<CallGraphEdge>` |

### 5.6 symbols_in_file

```rust
async fn symbols_in_file(
    &self,
    file_path: &Path,
) -> Result<Vec<Symbol>, CodeIntelError>;
```

获取文件中的所有符号概览。

**示例**：

```rust
// "payment.service.ts里有哪些函数"
let symbols = code_intel.symbols_in_file(
    Path::new("src/services/payment.service.ts")
).await?;
```

### 5.7 impact_analysis

```rust
async fn impact_analysis(
    &self,
    symbol_id: &SymbolId,
) -> Result<ImpactReport, CodeIntelError>;
```

分析修改该符号的影响范围。

**返回值 ImpactReport**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `symbol` | `Symbol` | 目标符号 |
| `direct_callers` | `Vec<Symbol>` | 直接调用方 |
| `transitive_callers` | `Vec<Symbol>` | 传递调用方 |
| `affected_files` | `Vec<String>` | 受影响的文件列表 |
| `risk_level` | `RiskLevel` | Low / Medium / High |

### 5.8 query (统一入口)

```rust
async fn query(
    &self,
    intent: &QueryIntent,
) -> Result<QueryResult, CodeIntelError>;
```

根据 QueryIntent 自动路由到上述具体方法。

**QueryResult 变体**：

```rust
enum QueryResult {
    SymbolList(Vec<Symbol>),
    ReferenceList(Vec<Reference>),
    CallGraph(CallGraph),
    ImpactReport(ImpactReport),
    ChangeHistory(Vec<ChangeRecord>),
    SymbolOverview(Vec<Symbol>),
}
```

### 5.9 change_history

```rust
async fn change_history(
    &self,
    scope: ChangeScope,
    time_range: Option<TimeRange>,
    git: &dyn GitIntelligence,
) -> Result<Vec<ChangeRecord>, CodeIntelError>;
```

查询模块/文件/符号的变更历史。`git` 参数为显式依赖注入。

### 5.10 错误码

| 错误变体 | 说明 | 用户感知 |
|---------|------|---------|
| `ParseError { file, line, message }` | 文件解析失败 | 索引报告中标注 |
| `SymbolNotFound { name }` | 符号未找到 | 空结果卡片 |
| `IndexNotReady { progress }` | 索引构建中 | "索引构建中，请稍候" |
| `UnsupportedLanguage { language }` | 不支持的语言 | "暂不支持该语言" |
| `QueryError { reason }` | 查询执行错误 | 具体原因 |
| `ProjectNotIndexed { path }` | 项目未索引 | "请先打开项目" |

---

## 6. Environment Manager

### 6.1 detect_project

```rust
async fn detect_project(&self, path: &Path) -> Result<ProjectMeta, EnvError>;
```

扫描目录，识别项目语言、框架、依赖文件。

### 6.2 check_runtime

```rust
async fn check_runtime(
    &self,
    language: Language,
    required_version: &str,  // semver constraint, e.g. ">=18.0.0"
) -> RuntimeStatus;
```

检查运行时是否已安装。返回值：

```rust
enum RuntimeStatus {
    Installed { version: Version, path: String },
    NotInstalled { required: Version },
    Outdated { current: Version, required: Version },
}
```

### 6.3 install_runtime

```rust
async fn install_runtime(
    &self,
    language: Language,
    version: &str,
) -> Result<(), EnvError>;
```

安装指定版本的运行时。

### 6.4 install_dependencies

```rust
async fn install_dependencies(
    &self,
    project: &ProjectMeta,
) -> Result<DepInstallReport, EnvError>;
```

安装项目依赖。

**返回值 DepInstallReport**：

| 字段 | 类型 |
|------|------|
| `packages_installed` | `u32` |
| `packages_cached` | `u32` |
| `duration_ms` | `u64` |
| `warnings` | `Vec<String>` |

### 6.5 错误码

| 错误变体 | 用户感知 |
|---------|---------|
| `UnsupportedLanguage { .. }` | "暂不支持该语言" |
| `RuntimeInstallFailed { reason }` | 显示失败原因 + 手动安装指引 |
| `DependencyInstallFailed { reason }` | 显示失败的包 + 重试按钮 |
| `NetworkError { message }` | "请检查网络连接或配置代理" |
| `PermissionDenied { path }` | "没有写入权限" |
| `UnknownProjectType { path }` | 询问用户："这个项目用什么语言？" |

---

## 7. Git Intelligence

### 7.1 log

```rust
async fn log(
    &self,
    repo_path: &Path,
    scope: &ChangeScope,
    time_range: Option<TimeRange>,
    author: Option<&str>,
    max_commits: u32,
) -> Result<Vec<CommitInfo>, GitError>;
```

查询变更日志。

**ChangeScope 变体**：

```rust
enum ChangeScope {
    File(String),        // 单个文件
    Directory(String),   // 目录
    Symbol(SymbolId),    // 符号（需CodeIntel提供文件路径）
}
```

### 7.2 diff

```rust
async fn diff(
    &self,
    repo_path: &Path,
    commit_hash: &str,
) -> Result<DiffData, GitError>;
```

获取提交的详细 diff。

### 7.3 blame

```rust
async fn blame(
    &self,
    repo_path: &Path,
    file_path: &Path,
    line: u32,
) -> Result<BlameInfo, GitError>;
```

查看某行的最后修改信息。

**返回值 BlameInfo**：

| 字段 | 类型 |
|------|------|
| `commit_hash` | `String` |
| `author` | `String` |
| `timestamp` | `DateTime` |
| `summary` | `String` |
| `line_content` | `String` |

### 7.4 错误码

| 错误变体 | 说明 |
|---------|------|
| `NotAGitRepo { path }` | 目录不是 Git 仓库 |
| `CommitNotFound { hash }` | 提交不存在 |
| `FileNotTracked { path }` | 文件未被 Git 追踪 |
| `GitCommandFailed { command, stderr }` | Git 命令执行失败 |

---

## 8. Voice Pipeline

### 8.1 start

```rust
async fn start(&self);
```

启动语音管线。后台监听唤醒词 → 录音 → 转写 → 发出 VoiceTranscribed 事件。内部管理完整状态机。

### 8.2 stop

```rust
async fn stop(&self);
```

停止语音管线。

### 8.3 speak

```rust
async fn speak(&self, text: &str) -> Result<(), VoiceError>;
```

TTS 并播放音频。

### 8.4 set_silent_mode

```rust
fn set_silent_mode(&self, silent: bool);
```

切换无声模式。`true` 时内部调用 `stop`，`false` 时内部调用 `start`。

### 8.5 错误码

| 错误变体 | 用户感知 |
|---------|---------|
| `NoMicrophone` | "请连接麦克风" |
| `PermissionDenied` | "请在系统设置中允许麦克风权限" |
| `TranscriptionFailed { reason }` | 切换为文字输入，提示原因 |
| `SynthesisFailed { .. }` | 降级为纯文本提示 |
| `WakeWordTimeout` | 自动回到监听（用户无感） |
| `DeviceBusy` | "麦克风被其他应用占用" |

---

## 9. UI Renderer

### 9.1 show_card

```rust
fn show_card(&self, card: Card);
```

显示结果卡片。从右侧滑入（300ms ease-out）。

**Card 结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `String` | 唯一ID |
| `type` | `CardType` | call_graph / reference_list / change_history / code_preview / env_status / ambiguity_options |
| `title` | `String` | 卡片标题 |
| `data` | `CardData` | 卡片数据载荷 |
| `ttl_seconds` | `u32` | 存活时间，0 = 手动关闭 |
| `created_at` | `DateTime` | |
| `related_intent_id` | `String` | 关联的意图ID |

### 9.2 navigate_to_code

```rust
fn navigate_to_code(
    &self,
    file: &Path,
    line: Option<u32>,
    highlight: Option<(u32, u32)>,  // (start_line, end_line) 高亮范围
);
```

跳转到代码位置并高亮。

### 9.3 set_breath

```rust
fn set_breath(&self, state: BreathState);
```

设置呼吸灯状态。

```rust
enum BreathState {
    Off,
    Idle,       // #00ff88 20%
    Listening,  // pulse 1.5s
    Working,    // spin 0.8s
    Warning,    // #ff8800 blink
}
```

### 9.4 show_input_bar

```rust
fn show_input_bar(&self, prefilled_text: Option<&str>);
```

唤起意图输入条（文字模式）。Ctrl+Space 触发。

---

## 10. 事件总线 API

### 10.1 完整事件清单

```rust
enum Event {
    // 项目生命周期
    ProjectOpened { root: String, meta: ProjectMeta },
    ProjectClosed { root: String },

    // 环境生命周期
    EnvDetecting { root: String },
    EnvRuntimeMissing { language: Language, needed: String },
    EnvInstallingRuntime { language: Language, progress: f32 },
    EnvInstallingDeps { progress: f32, current_package: String },
    EnvReady { meta: ProjectMeta },
    EnvError { message: String, recoverable: bool },

    // 索引生命周期
    IndexStarted { total_files: u32 },
    IndexProgress { current: u32, total: u32, current_file: String },
    IndexFileDone { file: String, symbols: u32 },
    IndexReady { symbol_count: u32, duration_ms: u64 },
    IndexError { message: String, file: Option<String> },

    // 文件变更
    FileChanged { path: String, change_type: ChangeType },
    FileCreated { path: String },
    FileDeleted { path: String },

    // 上下文变更
    ContextChanged { delta: ContextDelta },

    // 查询
    QueryStarted { intent: QueryIntent },
    QueryCompleted { intent: QueryIntent, result_count: u32, latency_ms: u64 },
    QueryError { intent: QueryIntent, error: String },

    // 语音
    VoiceWakeDetected,
    VoiceListeningStarted,
    VoiceTranscribed { text: String },
    VoiceError { error: VoiceError },

    // UI
    CardShown { card_id: String, card_type: CardType },
    CardDismissed { card_id: String },
    CardInteracted { card_id: String, action: String },
    InputBarFocused { source: InputSource },
    SilentModeToggled { silent: bool },

    // 系统
    SystemShutdown,
    SystemError { message: String, fatal: bool },
}
```

### 10.2 标准事件路由

| 触发事件 | 响应动作 | 执行方式 |
|---------|---------|---------|
| `ProjectOpened` | EnvMgr.detect_project | sync → 触发后续 Env 事件 |
| `EnvReady` | CodeIntel.index_project | spawn async |
| `FileChanged` | CodeIntel.index_file | spawn async (防抖500ms) |
| `FileDeleted` | KnowledgeStore.symbols_remove | spawn async |
| `VoiceWakeDetected` | UIRenderer.set_breath(Listening) | sync |
| `VoiceTranscribed` | IntentEngine.parse → CodeIntel.query | sync parse + spawn query |
| `QueryCompleted` | KnowledgeStore.history_record | spawn async |
| `ContextChanged` | CodeIntel 预加载相关数据 | spawn async |
| `SilentModeToggled` | VoicePipeline.set_silent_mode | sync |
| `SystemError { fatal: true }` | 显示紧急通知 + 优雅降级 | sync |

---

## 11. Knowledge Store

### 11.1 符号操作

```rust
async fn symbols_upsert(&self, symbols: &[Symbol]) -> Result<u32, StoreError>;
async fn symbols_remove(&self, file_path: &Path) -> Result<u32, StoreError>;
async fn symbols_find_by_name(&self, name: &str, kind: Option<SymbolKind>, limit: u32) -> Result<Vec<Symbol>, StoreError>;
async fn symbols_find_by_file(&self, file_path: &Path) -> Result<Vec<Symbol>, StoreError>;
async fn symbols_find_by_module(&self, module_path: &str) -> Result<Vec<Symbol>, StoreError>;
async fn symbols_search(&self, query: &str, limit: u32) -> Result<Vec<Symbol>, StoreError>;
```

### 11.2 引用操作

```rust
async fn refs_upsert(&self, refs: &[Reference]) -> Result<u32, StoreError>;
async fn refs_remove_for_file(&self, file_path: &Path) -> Result<u32, StoreError>;
async fn refs_find_by_target(&self, symbol_id: &SymbolId) -> Result<Vec<Reference>, StoreError>;
async fn refs_find_by_source(&self, symbol_id: &SymbolId) -> Result<Vec<Reference>, StoreError>;
```

### 11.3 调用图操作

```rust
async fn callgraph_store(&self, graph: &CallGraph) -> Result<(), StoreError>;
async fn callgraph_get(&self, symbol_id: &SymbolId, direction: CallDirection, max_depth: u32) -> Result<CallGraph, StoreError>;
async fn callgraph_rebuild_for_file(&self, file_path: &Path) -> Result<(), StoreError>;
```

### 11.4 项目与偏好

```rust
async fn project_get(&self, path: &Path) -> Result<Option<ProjectMeta>, StoreError>;
async fn project_upsert(&self, meta: &ProjectMeta) -> Result<(), StoreError>;
async fn project_list(&self) -> Result<Vec<ProjectMeta>, StoreError>;
async fn pref_get(&self, key: &str) -> Result<Option<serde_json::Value>, StoreError>;
async fn pref_set(&self, key: &str, value: &serde_json::Value) -> Result<(), StoreError>;
```

### 11.5 查询历史

```rust
async fn history_record(&self, entry: QueryHistoryEntry) -> Result<(), StoreError>;
async fn history_recent(&self, limit: u32) -> Result<Vec<QueryHistoryEntry>, StoreError>;
```

### 11.6 错误码

| 错误变体 | 说明 |
|---------|------|
| `ConnectionError { reason }` | 数据库连接失败 |
| `QueryError { reason }` | 查询执行失败 |
| `MigrationError { reason }` | 数据库迁移失败 |
| `SerializationError { reason }` | JSON 序列化/反序列化失败 |

---

## 12. File Watcher

```rust
trait FileWatcher {
    fn watch(&self, path: &Path, patterns: &[&str]) -> Result<(), WatchError>;
    fn unwatch(&self, path: &Path) -> Result<(), WatchError>;
    fn pause(&self);
    fn resume(&self);
}

enum WatchError {
    PathNotFound { path: String },
    TooManyFiles { path: String, count: u32 },
    SystemWatcherError { reason: String },
}
```

FileWatcher 监听文件系统变更，发出 `FileChanged`、`FileCreated`、`FileDeleted` 事件。内部使用平台原生 API（macOS FSEvents / Linux inotify / Windows ReadDirectoryChangesW）。

---

## 13. 版本化策略

| 版本阶段 | API 兼容性承诺 |
|---------|--------------|
| v0.x (MVP) | 不保证向后兼容。接口可以随时变更 |
| v1.0 | trait 方法签名稳定。新增方法允许。事件 enum 新增变体允许 |
| v2.0+ | 主版本号递增时允许 breaking changes |

当前所有 API 标记为 `#[doc(version = "0.1")]`。
