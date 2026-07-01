# 系统架构

## 架构原则

1. **模块化单体起步** — MVP以单体应用运行，模块间通过明确接口通信（trait/interface）。后续可拆分为独立进程
2. **语言无关核心 + 语言特定插件** — 索引引擎、环境管理器、查询引擎的骨架不依赖特定语言。JS/TS/Python的支持通过解析器插件接入
3. **异步索引，同步查询** — 代码索引在后台持续异步更新。用户查询时直接读已建好的索引，保证响应速度
4. **本地优先** — MVP不依赖任何云服务。所有数据在本地
5. **接口即文档** — 每个模块对外暴露的接口是它的契约。模块内部实现可以随意重构

---

## 一、系统分层

```
┌──────────────────────────────────────────────────┐
│  HUMAN INTERFACE LAYER                           │
│                                                  │
│  Voice Input  │  Text Input  │  Card Renderer    │
│  (STT+Wake)  │  (Ctrl+Space)│  (CallGraph,Ref,  │
│              │              │   History,Diff)   │
│  Voice Output│  Code Viewer │  Status Indicator │
│  (TTS)       │              │                   │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────┐
│  INTENT ORCHESTRATION LAYER                      │
│                                                  │
│  Intent Parser  │  Context Manager  │  Router    │
│  (NLU+Entity)  │  (File,Cursor,    │            │
│                │   Selection,Hist) │            │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────┐
│  CAPABILITY LAYER                                │
│                                                  │
│  Code Intelligence │ Environment Mgr │ Git Intel │
│  (Parser,Index,    │ (Detect,Install, │ (Log,     │
│   Query,CallGraph) │  Config)         │  Diff,    │
│                    │                  │  Blame)   │
│  File Watcher      │                  │           │
│  (FS events →      │                  │           │
│   incremental idx) │                  │           │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────┐
│  DATA & KNOWLEDGE LAYER                          │
│                                                  │
│  Semantic Index   │  Project Store  │  Prefs     │
│  (Symbols,Refs,   │  (Metadata,     │  (User     │
│   CallGraph,      │   Dependencies, │   Config,  │
│   ChangeLog)      │   Runtime Info) │   History) │
└──────────────────────────────────────────────────┘
```

**层级约束**：上层可以调用下层，下层永远不依赖上层。同层模块通过接口通信，不直接访问对方内部数据结构。

---

## 二、核心模块

### 模块1：Nodus Shell
**职责**：应用生命周期、模块初始化与注册、全局事件总线。

| 接口 | 说明 |
|------|------|
| `init()` | 启动所有模块，建立模块间连接 |
| `register_module(name, module)` | 注册模块到系统中 |
| `emit(event, payload)` | 全局事件发布 |
| `on(event, handler)` | 全局事件订阅 |

### 模块2：Intent Engine
**职责**：将自然语言输入（来自语音或文字）解析为结构化查询意图。

**处理流水线**：
```
原始文本 → 意图分类 → 实体提取 → 歧义判断 → 结构化QueryIntent
```

| 接口 | 说明 |
|------|------|
| `parse(text: string, context: Context) → QueryIntent` | 解析自然语言为结构化意图 |
| `resolve_ambiguity(intent, user_choice)` | 用户从歧义选项中选定后，补全意图 |

**意图分类**（MVP覆盖）：

| 意图类型 | 触发模式示例 |
|---------|------------|
| `find_definition` | "X在哪里定义的""X的定义" |
| `find_references` | "X被哪些地方调用了""谁引用了X" |
| `call_graph` | "X的调用链路""从A到B的调用路径" |
| `impact_analysis` | "改了X会影响哪些文件" |
| `change_history` | "X模块最近改了什么""上周谁动了Y" |
| `symbol_overview` | "X文件里有哪些函数" |

**歧义处理**：当Intent Engine对解析结果置信度低于阈值时，生成2-3个候选意图，交给用户选择。

### 模块3：Context Manager
**职责**：持续追踪开发者在系统中的当前状态，为意图解析提供隐式参数。

| 追踪项 | 说明 |
|--------|------|
| `active_file` | 当前查看/编辑的文件路径 |
| `cursor_position` | 光标所在的行列及符号 |
| `selection` | 当前选中的代码范围 |
| `recent_queries` | 最近N次查询历史 |
| `active_project` | 当前工作目录 |

| 接口 | 说明 |
|------|------|
| `snapshot() → Context` | 获取当前完整上下文快照 |
| `update(delta: ContextDelta)` | 更新上下文，内部通过事件总线发布 ContextChanged |

### 模块4：Code Intelligence
**职责**：代码库的语义理解引擎。这是MVP的核心。

**子模块**：

```
Code Intelligence
├── Parser Manager      — 管理各语言的tree-sitter解析器
├── Symbol Extractor    — 从AST提取符号定义
├── Reference Resolver  — 解析符号间的引用关系
├── Call Graph Builder  — 构建函数/方法的调用图
├── Incremental Updater — 文件变更时增量更新索引
└── Query Engine        — 对外暴露的查询接口

持久化通过 KnowledgeStore 完成，Code Intelligence 不内嵌存储层。
```

| 接口 | 说明 |
|------|------|
| `index_project(path)` | 全量索引一个项目 |
| `index_file(path)` | 增量索引单个文件 |
| `find_symbol(name, kind?) → [Symbol]` | 按名称查找符号 |
| `find_references(symbol_id) → [Reference]` | 查找符号的所有引用 |
| `call_graph(symbol_id, direction, depth) → CallGraph` | 获取调用图 |
| `symbol_overview(file_path) → [Symbol]` | 获取文件中的符号列表 |
| `impact_analysis(symbol_id) → ImpactReport` | 分析修改影响范围 |
| `query(query_intent: QueryIntent) → QueryResult` | 统一的查询入口 |

**解析器插件接口**（见 07-detailed-design.md 中 LanguageParser trait 的完整 Rust 定义）：

```rust
// 语言枚举
enum Language { TypeScript, JavaScript, Python }

// 解析器trait（核心方法）
trait LanguageParser: Send + Sync {
    fn language(&self) -> Language;
    fn file_extensions(&self) -> &[&str];
    fn parse(&self, source: &str, file_path: &Path) -> Result<Ast, ParseError>;
    fn extract_symbols(&self, ast: &Ast, file_path: &Path) -> Vec<Symbol>;
    fn extract_references(&self, ast: &Ast, symbols: &[Symbol]) -> Vec<Reference>;
    fn extract_call_edges(&self, ast: &Ast, symbols: &[Symbol]) -> Vec<CallEdge>;
}
```

### 模块5：Environment Manager
**职责**：检测、安装、配置项目运行时和依赖。人类不需要知道它的存在。

| 接口 | 说明 |
|------|------|
| `detect_project(path) → ProjectMeta` | 检测项目语言、框架、依赖文件 |
| `check_runtime(lang, version) → RuntimeStatus` | 检查运行时是否已安装 |
| `install_runtime(lang, version) → Result` | 安装指定版本的运行时 |
| `install_dependencies(path) → Result` | 安装项目依赖 |
| `status() → EnvStatus` | 当前环境状态（就绪/安装中/异常） |

**支持的运行时管理**（MVP）：
- Node.js：通过 fnm 或内置版本管理
- Python：通过 pyenv 或内置版本管理

### 模块6：Git Intelligence
**职责**：封装git操作，提供代码变更历史的查询能力。

| 接口 | 说明 |
|------|------|
| `log(path, time_range?, author?) → [Commit]` | 查询变更历史 |
| `diff(commit_hash) → Diff` | 获取某次提交的diff |
| `blame(file_path, line) → Commit` | 查看某行代码的最后修改 |
| `changed_symbols(commit_hash) → [Symbol]` | 某次提交涉及哪些符号的变更 |

### 模块7：UI Renderer
**职责**：渲染结构化卡片、代码查看器、意图输入条。管理所有视觉输出。

| 接口 | 说明 |
|------|------|
| `show_card(card: Card)` | 显示一个结果卡片 |
| `dismiss_card(card_id)` | 消散一个卡片 |
| `show_code(file, line?)` | 在代码查看器中打开文件 |
| `show_input_bar()` | 唤起意图输入条 |
| `show_breath(status)` | 更新呼吸灯状态 |

**卡片类型与渲染模板**：

| 卡片类型 | 视觉结构 |
|---------|---------|
| CallGraphCard | 树状节点图，可展开/折叠，每节点可点击跳转 |
| ReferenceListCard | 分组列表（按文件分组），显示行号和代码片段预览 |
| ChangeHistoryCard | 时间线，每次commit摘要，可展开看diff |
| AmbiguityCard | 2-3个选项按钮，用户选择后消散 |
| EnvStatusCard | 进度条或就绪标记，异常时显示原因 |

### 模块8：Voice Pipeline
**职责**：语音唤醒、语音转文字、文字转语音。

| 接口 | 说明 |
|------|------|
| `start()` | 启动语音管线（唤醒词监听→录音→转写自动完成） |
| `stop()` | 停止语音管线 |
| `speak(text) → Result` | 文字转语音并播放 |
| `set_silent_mode(bool)` | 进入/退出无声模式（内部管理start/stop） |

### 模块9：Knowledge Store
**职责**：所有持久化数据的存储层。上层模块不直接操作文件或数据库，通过Store接口访问。

| 接口 | 说明 |
|------|------|
| `symbols.upsert(symbols)` | 写入/更新符号索引 |
| `symbols.query(criteria) → [Symbol]` | 查询符号 |
| `refs.upsert(refs)` | 写入引用关系 |
| `refs.query(criteria) → [Reference]` | 查询引用 |
| `project.get(path) → ProjectMeta` | 获取项目元数据 |
| `project.set(path, meta)` | 保存项目元数据 |
| `prefs.get(key) → value` | 读取用户偏好 |
| `prefs.set(key, value)` | 写入用户偏好 |

---

## 三、核心数据模型

### Symbol（符号）

```typescript
interface Symbol {
  id: string;                    // 全局唯一ID (hash of path+name+location)
  name: string;                  // 符号名称
  kind: SymbolKind;              // 符号种类
  language: 'typescript' | 'javascript' | 'python';
  location: SourceLocation;      // 定义位置
  parent_id?: string;            // 父符号ID（类的方法→类本身）
  is_exported: boolean;          // 是否从模块导出
  signature?: string;            // 函数签名/类型签名
  doc_comment?: string;          // 文档注释摘要
}

type SymbolKind = 'function' | 'method' | 'class' | 'interface' | 'type'
  | 'variable' | 'parameter' | 'module' | 'decorator';

interface SourceLocation {
  file_path: string;
  line_start: number;
  line_end: number;
  col_start: number;
  col_end: number;
}
```

### Reference（引用关系）

```typescript
interface Reference {
  id: string;
  source_symbol_id: string;      // 谁引用了
  target_symbol_id: string;      // 被引用的符号
  location: SourceLocation;      // 引用发生的位置
  kind: ReferenceKind;           // 引用类型
}

type ReferenceKind = 'call' | 'import' | 'inheritance' | 'type_use'
  | 'instantiation' | 'override' | 'decorator_use';
```

### CallGraph（调用图）

```typescript
interface CallGraph {
  root_symbol_id: string;
  direction: 'callers' | 'callees' | 'both';
  max_depth: number;
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
}

interface CallGraphNode {
  symbol_id: string;
  symbol_name: string;
  file_path: string;
  line: number;
  depth: number;
  has_risk?: boolean;            // 是否有潜在问题标记
}

interface CallGraphEdge {
  from: string;                  // symbol_id
  to: string;
  kind: ReferenceKind;
}
```

### QueryIntent（查询意图）

```rust
struct QueryIntent {
    raw_text: String,
    intent_type: IntentType,
    confidence: f32,           // 0.0 - 1.0
    entities: IntentEntity,    // 见 07-detailed-design 中定义
    context_snapshot: Context, // 来自ContextManager
    candidates: Option<Vec<QueryIntent>>,  // 歧义时的候选意图
}

enum IntentType {
    FindDefinition,
    FindReferences,
    CallGraph,
    ImpactAnalysis,
    ChangeHistory,
    SymbolOverview,
}
```


### Card（结果卡片）

```typescript
interface Card {
  id: string;
  type: CardType;
  title: string;
  data: CallGraphData | ReferenceListData | ChangeHistoryData | AmbiguityData;
  ttl_seconds: number;           // 0 = 手动关闭
  created_at: Date;
  related_intent_id: string;     // 关联的意图ID
}

type CardType = 'call_graph' | 'reference_list' | 'change_history'
  | 'code_preview' | 'env_status' | 'ambiguity_options';
```

---

## 四、关键数据流

### 流程1：项目打开 → 环境就绪

```
User opens project dir
        │
        ▼
    Shell.detect_project(path)
        │
        ▼
    EnvironmentManager.detect_project()
    ├── 扫描文件：package.json? pyproject.toml?
    ├── 识别语言：TypeScript + Python
    ├── 提取版本：Node>=18, Python>=3.11
    └── 返回 ProjectMeta
        │
        ▼
    EnvironmentManager.check_runtime()
    ├── Node 22.5.1 → 已安装 ✓
    ├── Python 3.12.0 → 未安装 ✗
    └── install_runtime('python', '3.12.0')
        │
        ▼
    EnvironmentManager.install_dependencies()
    ├── npm install (或 yarn/pnpm)
    └── pip install -r requirements.txt
        │
        ▼
    Shell.emit('env:ready', { project_meta })
        │
        ▼
    UIRenderer.show_card(EnvStatusCard { status: 'ready' })
        │
        ▼
    Shell.emit('project:ready')  → 触发索引
```

### 流程2：语义索引构建

```
Shell.emit('project:ready')
        │
        ▼
    CodeIntelligence.index_project(path)
        │
        ├── 遍历所有源文件（.ts/.tsx/.js/.py）
        ├── 对每个文件：
        │   ├── ParserManager.parse(file) → AST
        │   ├── SymbolExtractor.extract(ast) → [Symbol]
        │   ├── ReferenceResolver.resolve(ast, symbols) → [Reference]
        │   └── KnowledgeStore.upsert(symbols, refs)
        │
        ├── 全文件解析完成后：
        │   ├── CallGraphBuilder.build(all_symbols, all_refs) → CallGraph
        │   └── KnowledgeStore.store_callgraph(callgraph)
        │
        └── Shell.emit('index:ready', { symbol_count, file_count })
        │
        ▼
    UIRenderer.show_breath({ status: 'ready' })
```

**增量更新**（文件变更时）：
```
FileWatcher detects change → emits Event::FileChanged
        │
        ▼ (event handler spawns async task)
    CodeIntelligence.index_file(changed_path)
        ├── 重新解析该文件
        ├── 移除该文件旧符号和引用
        ├── 插入新符号和引用
        ├── 增量更新调用图（只更新受影响的边）
        └── 调用 KnowledgeStore 持久化变更
```

### 流程3：自然语言查询（语音路径）

```
User: "Nodus, refundOrder被哪些地方调用了"
        │
        ▼
    VoicePipeline detects wake word "Nodus"
        ├── 发出 VoiceWakeDetected 事件（呼吸灯变色）
        ├── 内部自动录音 → VAD检测结束 → 自动转写
        └── 发出 VoiceTranscribed { text: "refundOrder被哪些地方调用了" }
        │
        ▼
    (event handler receives VoiceTranscribed)
    ContextManager.snapshot() → Context
        │
        ▼
    IntentEngine.parse(text, context)
        ├── 意图分类 → find_references (confidence: 0.94)
        ├── 实体提取 → { symbol_name: "refundOrder" }
        ├── 置信度 > 阈值 (0.8) → 无需歧义反问
        └── 返回 QueryIntent
        │
        ▼
    CodeIntelligence.query(query_intent)
        ├── KnowledgeStore.symbols.query({ name: "refundOrder" })
        ├── 找到1个匹配符号 (id: sym_abc123)
        ├── KnowledgeStore.refs.query({ target_symbol_id: "sym_abc123" })
        └── 返回14条引用 + 3条标注风险
        │
        ▼
    UIRenderer.show_card(ReferenceListCard {
        title: "refundOrder — 14处引用",
        data: [...references],
        highlights: [3处amount可能为undefined]
    })
```

### 流程4：变更历史查询

```
User: "Nodus, auth模块最近一周改了什么"
        │
        ▼
    IntentEngine.parse() → QueryIntent {
        intent_type: 'change_history',
        entities: { module_name: 'auth', time_range: { from: -7d, to: now } }
    }
        │
        ▼
    CodeIntelligence.query()
        ├── 从KnowledgeStore找到auth模块的所有文件
        └── 对每个文件调用 GitIntelligence.log(path, time_range)
        │
        ▼
    GitIntelligence.log()
        ├── git log --since="7 days ago" -- src/auth/
        ├── 对每个commit，通过CodeIntelligence获取涉及的符号
        └── 返回 [{ commit, changed_symbols, diff_summary }]
        │
        ▼
    UIRenderer.show_card(ChangeHistoryCard {
        title: "auth模块 — 最近一周变更",
        data: { commits: [...], timeline: [...] }
    })
```

---

## 五、技术选型讨论

以下列出关键组件的候选技术方案及取舍。最终选择留待详细设计阶段决定。

### 应用外壳

| 方案 | 优势 | 劣势 |
|------|------|------|
| **Tauri** (Rust + Web前端) | 与长期Rust内核方向一致；包体小；内存安全 | Web技术做代码编辑器渲染有一定复杂度 |
| **Electron** (Node + Chromium) | 生态极成熟；Monaco/CodeMirror开箱即用；开发快 | 包体大；内存占用高 |
| **纯Rust** (egui/iced) | 性能极致；与内核方向完全一致 | UI开发效率低；复杂卡片渲染困难 |

**倾向**：Tauri — 兼顾开发效率和长期方向。前端用React + Canvas/SVG渲染卡片。

### 代码解析

| 方案 | 评估 |
|------|------|
| **tree-sitter** | 几乎唯一选择。语言无关、增量解析、Rust/Node/Python绑定成熟、支持JS/TS/Python。 |

### 语义索引存储

| 方案 | 评估 |
|------|------|
| **SQLite** | 存储符号和引用关系。成熟、零配置、嵌入式、查询快。 |
| **内存索引 + SQLite持久化** | 查询走内存（毫秒级），SQLite做持久化和恢复。推荐。 |

### 语音处理

| 方案 | 评估 |
|------|------|
| **Whisper.cpp** (本地) | 隐私、离线、免费。延迟略高但可接受。 |
| **系统原生API** (Apple Speech / Windows Speech) | 延迟低、不占资源。但跨平台不一致。 |
| 唤醒词检测 | porcupine / openwakeword，或VAD（语音活动检测）+ 简单触发 |

**倾向**：MVP使用系统原生API降低复杂度。后续切换到Whisper.cpp以统一体验。

### UI渲染

| 方案 | 评估 |
|------|------|
| **React + Canvas** | 卡片渲染灵活；生态丰富。调用图可用D3/自定义Canvas渲染。 |
| **React + SVG** | 调用图天然适合SVG；卡片用DOM。简单直接。 |
| Monaco Editor | 代码查看/编辑。Monaco是VSCode的编辑器内核。 |

**倾向**：React + SVG（卡片+调用图）+ Monaco（代码查看）。

---

## 六、项目目录结构（草案）

```
NodusOS/
├── docs/                    # 产品与架构文档
├── src/
│   ├── shell/              # Nodus Shell — 应用入口、模块管理
│   ├── intent/             # Intent Engine — NLU、意图解析
│   ├── context/            # Context Manager — 开发者上下文追踪
│   ├── code-intel/         # Code Intelligence — 语义索引引擎
│   │   ├── parsers/        # tree-sitter 解析器管理
│   │   ├── extractors/     # 符号提取（语言特定）
│   │   ├── indexer/        # 索引构建与存储
│   │   └── query/          # 查询引擎
│   ├── env-mgr/            # Environment Manager — 环境检测与安装
│   ├── file-watcher/       # File Watcher — 文件系统变更监听
│   ├── git-intel/          # Git Intelligence — 变更历史
│   ├── voice/              # Voice Pipeline — STT/TTS/唤醒
│   ├── ui/                 # UI Renderer — 卡片、代码视图、输入条
│   │   ├── cards/          # 各类卡片组件
│   │   ├── code-view/      # 代码查看器
│   │   └── shell-ui/       # 意图输入条、呼吸灯等
│   ├── store/              # Knowledge Store — 持久化层
│   └── common/             # 共享类型、工具函数
├── parsers/                 # tree-sitter 语法文件（子模块或内置）
├── tests/
├── Cargo.toml              # 如果选Rust/Tauri
└── package.json            # 如果选Node/Electron
```

---

## 下一步

架构文档完成后，需要进入：
1. **接口详细设计**：每个模块的接口方法签名、参数、返回值
2. **存储Schema设计**：SQLite表结构、索引策略
3. **技术选型确认**：选定具体技术栈后调整架构细节
4. **第一个可执行原型**：能索引一个TypeScript文件并响应"这个函数在哪被调用"
