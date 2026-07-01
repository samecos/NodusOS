# Nodus 详细设计文档 (Detailed Design Document)

> 版本: v1.0 | 日期: 2026-05-04

---

## 1. 引言

本文档描述 Nodus 各模块的内部设计，包括类结构、时序交互、并发模型和错误处理框架。本文档是 HLD 的细化，面向模块实现者。

**前置阅读**：[01-HLD.md](01-HLD.md) — 了解系统分层和模块职责。

---

## 2. 核心类图

### 2.1 Code Intelligence — 内部结构

```
┌─────────────────────────────────────────────────────────────────┐
│                      CodeIntelligence                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ + index_project(path, languages) → IndexReport              ││
│  │ + index_file(path) → FileIndexResult                         ││
│  │ + find_symbol(name, kind?, file?, limit) → Vec<Symbol>      ││
│  │ + find_references(symbol_id) → Vec<Reference>               ││
│  │ + call_graph(symbol_id, dir, depth) → CallGraph             ││
│  │ + symbols_in_file(path) → Vec<Symbol>                       ││
│  │ + impact_analysis(symbol_id) → ImpactReport                 ││
│  │ + query(intent) → QueryResult                               ││
│  │ + change_history(scope, time, git) → Vec<ChangeRecord>      ││
│  │ + index_status() → IndexStatus                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌───────────────────┐    ┌───────────────────┐                 │
│  │  ParserManager    │    │  QueryEngine      │                 │
│  │                   │    │                   │                 │
│  │ - parsers:        │    │ - store: Arc<Know │                 │
│  │   HashMap<Lang,   │    │   ledgeStore>     │                 │
│  │   Box<dyn Lang    │    │                   │                 │
│  │   Parser>>       │    │ + route(intent)   │                 │
│  │                   │    │   → QueryResult   │                 │
│  │ + parse(file,src) │    │ + find_symbol()   │                 │
│  │   → Ast           │    │ + find_refs()     │                 │
│  │ + get(lang)       │    │ + build_graph()   │                 │
│  │   → &dyn Lang     │    └───────────────────┘                 │
│  │   Parser          │                                          │
│  └────────┬──────────┘    ┌────────────────────┐                │
│           │               │  IncrementalUpdater│                │
│           │ uses          │                    │                │
│           ▼               │ - debounce: Duration│               │
│  ┌───────────────────┐    │ - pending: HashSet │                │
│  │ <<interface>>      │    │   <PathBuf>        │                │
│  │ LanguageParser     │    │                    │                │
│  │                   │    │ + on_file_change() │                │
│  │ + language() → Lang│    │ + flush()          │                │
│  │ + extensions() →[] │    └────────────────────┘                │
│  │ + parse(src,path) │                                          │
│  │   → Result<Ast>   │    ┌────────────────────┐                │
│  │ + extract_symbols │    │  CallGraphBuilder  │                │
│  │   (ast,path)→[Sym]│    │                    │                │
│  │ + extract_refs    │    │ + build(all_syms,  │                │
│  │   (ast,syms)→[Ref]│    │   all_refs)        │                │
│  │ + extract_edges   │    │   → CallGraph      │                │
│  │   (ast,syms)      │    │ + rebuild_for_file │                │
│  │   → [CallEdge]    │    │   (path) → CallGraph│               │
│  └───────────────────┘    └────────────────────┘                │
│           △                                                      │
│           │ implements                                            │
│  ┌────────┴──────────┬──────────────────────┐                   │
│  │                   │                      │                    │
│  │ TypeScriptParser  │  JavaScriptParser   │  PythonParser      │
│  │ (tree-sitter-ts)  │  (tree-sitter-js)   │  (tree-sitter-py)  │
│  └───────────────────┘  └──────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 模块依赖图

```
                    ┌─────────────┐
                    │    Shell     │ (owns everything)
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────┴─────┐     ┌──────┴──────┐    ┌──────┴──────┐
   │  Intent  │     │   Context   │    │   Event     │
   │  Engine  │────→│   Manager   │    │   Bus       │
   └────┬─────┘     └─────────────┘    └─────────────┘
        │
        │ (calls query on CodeIntel)
        ▼
   ┌────┴─────────┐     ┌──────────────┐
   │  Code        │────→│  Knowledge   │
   │  Intelligence│     │  Store       │
   └──────────────┘     └──────────────┘
        │
        │ (change_history calls git)
        ▼
   ┌────┴─────────┐
   │  Git         │
   │  Intelligence│
   └──────────────┘

   ┌──────────────┐     ┌──────────────┐
   │  Environment │     │  File        │
   │  Manager     │     │  Watcher     │
   └──────────────┘     └──────────────┘
        │                     │
        └──────────┬──────────┘
                   │ (events only)
                   ▼
            ┌──────────────┐
            │  Event Bus    │
            └──────┬───────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐
   │  UI    │ │ Voice  │ │ Code   │
   │Renderer│ │Pipeline│ │ Intel  │
   └────────┘ └────────┘ └────────┘

   ───→  直接依赖（通过 trait 接口调用）
   - - → 松散耦合（通过 Event Bus 通信）
```

---

## 3. 关键时序图

### 3.1 端到端语音查询

```
User       VoicePipe   Shell/EB   IntentEng  CtxMgr   CodeIntel  KnowStore  UIRend
 │            │           │           │         │         │          │         │
 │ "Nodus"    │           │           │         │         │          │         │
 │───────────→│           │           │         │         │          │         │
 │            │ WakeDet   │           │         │         │          │         │
 │            │──────────→│           │         │         │          │         │
 │            │           │─────────────────────────────────────────────→│ breath
 │ "refund..."│           │           │         │         │          │   Listen
 │───────────→│           │           │         │         │          │         │
 │   VAD end  │           │           │         │         │          │         │
 │            │ VoiceTr   │           │         │         │          │         │
 │            │ {text}    │           │         │         │          │         │
 │            │──────────→│           │         │         │          │         │
 │            │           │ handler   │         │         │          │         │
 │            │           │──────────→│         │         │          │         │
 │            │           │           │ snapshot│         │          │         │
 │            │           │           │────────→│         │          │         │
 │            │           │           │ Context │         │          │         │
 │            │           │           │←────────│         │          │         │
 │            │           │           │         │         │          │         │
 │            │           │           │ parse(text,ctx)    │          │         │
 │            │           │           │─────────┼─────────│          │         │
 │            │           │           │         │  [本地模型推理, sync]  │         │
 │            │           │           │ QueryIntent        │          │         │
 │            │           │           │←────────┼─────────│          │         │
 │            │           │           │         │         │          │         │
 │            │           │           │ query(intent)      │          │         │
 │            │           │           │───────────────────→│          │         │
 │            │           │           │         │         │ find_by  │         │
 │            │           │           │         │         │ _name()  │         │
 │            │           │           │         │         │─────────→│         │
 │            │           │           │         │         │ Vec<Sym> │         │
 │            │           │           │         │         │←─────────│         │
 │            │           │           │         │         │ find_refs│         │
 │            │           │           │         │         │ _by_target()        │
 │            │           │           │         │         │─────────→│         │
 │            │           │           │         │         │ Vec<Ref> │         │
 │            │           │           │         │         │←─────────│         │
 │            │           │           │         │         │          │         │
 │            │           │           │  QueryResult       │          │         │
 │            │           │           │←───────────────────│          │         │
 │            │           │           │         │         │          │         │
 │            │           │           │ show_card(result)  │          │         │
 │            │           │           │─────────────────────────────────────→│
 │            │           │           │         │         │   Card    │  slide │
 │            │           │           │         │         │           │  in    │
 │            │           │           │         │         │          │         │
 │            │           │           │ navigate_to_code()│          │         │
 │            │           │           │─────────────────────────────────────→│
 │            │           │           │         │         │           │  jump  │
```

### 3.2 增量索引

```
FileWatcher      Shell/EB       CodeIntel       KnowStore
    │                │               │               │
    │ FileChanged    │               │               │
    │───────────────→│               │               │
    │                │ handler       │               │
    │                │ (debounce     │               │
    │                │  500ms)       │               │
    │                │              │               │
    │                │ spawn async   │               │
    │                │──────────────→│               │
    │                │               │               │
    │                │          index_file(path)     │
    │                │               │               │
    │                │               │ 1. 读取文件    │
    │                │               │ 2. 计算checksum│
    │                │               │ 3. tree-sitter parse │
    │                │               │    ├─ 成功 → 继续    │
    │                │               │    └─ 失败 → 记录    │
    │                │               │       ParseError     │
    │                │               │ 4. extract_symbols  │
    │                │               │ 5. extract_refs     │
    │                │               │               │
    │                │               │ symbols_remove(path) │
    │                │               │──────────────→│
    │                │               │    removed count    │
    │                │               │←──────────────│
    │                │               │               │
    │                │               │ symbols_upsert(new)  │
    │                │               │──────────────→│
    │                │               │    upserted count   │
    │                │               │←──────────────│
    │                │               │               │
    │                │               │ refs_upsert(new)    │
    │                │               │──────────────→│
    │                │               │               │
    │                │               │ callgraph_rebuild_  │
    │                │               │   for_file(path)    │
    │                │               │──────────────→│
    │                │               │               │
    │                │               │ 更新 file_index_state│
    │                │               │──────────────→│
    │                │               │               │
    │                │    IndexFileDone {file,syms}  │
    │                │←──────────────│               │
    │                │               │               │
    │                │   UI: breath  │               │
    │                │   stays Idle  │               │
```

---

## 4. 并发模型

### 4.1 线程/协程架构

```
┌─────────────────────────────────────────────────────────┐
│                    Tokio Runtime                          │
│                                                          │
│  ┌──────────────────────┐  ┌──────────────────────────┐ │
│  │  Main Thread          │  │  Background Worker Pool   │ │
│  │  (async, single)      │  │  (async, num_cpus threads)│ │
│  │                       │  │                           │ │
│  │  • Event Bus dispatch │  │  • Indexing tasks         │ │
│  │  • IntentEngine::parse│  │    - index_project()      │ │
│  │    (sync, <200ms)     │  │    - index_file()         │ │
│  │  • ContextManager     │  │  • Environment ops        │ │
│  │    snapshot (sync)    │  │    - install_runtime()    │ │
│  │  • UI event handling  │  │    - install_deps()       │ │
│  │                       │  │  • Git operations         │ │
│  └──────────────────────┘  │    - log(), diff(), blame()│ │
│                            │  • Voice Pipeline I/O       │
│  ┌──────────────────────┐  │    - record, transcribe    │ │
│  │  File Watcher Thread  │  │  • File Watcher events    │ │
│  │  (blocking)           │  │                           │ │
│  │                       │  └──────────────────────────┘ │
│  │  • notify-rs /        │                               │
│  │    platform FS events │  ┌──────────────────────────┐ │
│  │  • Debounce merge     │  │  UI Thread (WebView)      │ │
│  │  • Emits FileChanged  │  │                           │ │
│  │    events             │  │  • React reconciliation   │ │
│  └──────────────────────┘  │  • Monaco Editor          │ │
│                            │  • Card animations         │ │
│                            └──────────────────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Knowledge Store (Mutex<RwLock<Connection>>)       │   │
│  │  • Single writer, multiple readers via WAL mode   │   │
│  │  • Memory index behind RwLock<HashMap>            │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 4.2 锁策略

| 资源 | 锁类型 | 持有者 | 说明 |
|------|--------|--------|------|
| SQLite connection | `tokio::sync::Mutex` | Background pool | WAL模式允许并行读 |
| Memory symbol index | `std::sync::RwLock` | Main + Background | 读多写少，RwLock最优 |
| ContextManager state | `std::sync::RwLock` | Main thread only | 高频读（每查询1次），低频写 |
| EventBus subscribers | `std::sync::RwLock` | Main thread only | 启动时注册，运行时只读 |
| IndexStatus | `std::sync::atomic::AtomicU8` | Main + Background | 使用原子操作，无锁 |

### 4.3 异步操作清单

| 操作 | 执行位置 | 预计耗时 | 重试策略 |
|------|---------|---------|---------|
| index_project | Background pool | 1-30s | 单文件失败跳过，不重试 |
| index_file | Background pool | 50-500ms | 不重试（下次文件变更再试） |
| install_runtime | Background pool | 10s-2min | 网络错误重试2次 |
| install_dependencies | Background pool | 10s-5min | 网络错误重试2次 |
| git log | Background pool | 100ms-1s | 超时重试1次 |
| git diff | Background pool | 100ms-2s | 不重试 |
| voice record | Main (system API) | 0-8s (VAD) | 超时自动结束 |
| voice transcribe | Main (system API) | 200ms-1s | 重试1次 |
| IntentEngine::parse | Main (sync) | <200ms | 不重试（失败返回Error） |

---

## 5. 错误处理框架

### 5.1 错误传播路径

```
Module Error          →    Event Bus        →    User Impact
─────────────             ─────────             ────────────

CodeIntelError::
  ParseError          →    IndexError       →    索引报告中标明跳过文件
  SymbolNotFound      →    (returned to     →    返回空结果卡片
  IndexNotReady       →     caller, not     →    显示"索引构建中，请稍候"
  ProjectNotIndexed   →     via EventBus)   →    提示"请先打开项目"

EnvError::
  RuntimeInstallFailed →   EnvError         →    环境卡片显示失败+重试按钮
  NetworkError         →   EnvError         →    提示配置代理或手动安装
  UnknownProjectType   →   EnvError         →    询问用户项目语言

GitError::
  NotAGitRepo          →   (returned to     →    "变更历史不可用"
  CommitNotFound       →    caller)         →    blame信息缺失

VoiceError::
  NoMicrophone         →   VoiceError       →    提示"请连接麦克风"
  TranscriptionFailed  →   VoiceError       →    切换为文字输入模式
  WakeWordTimeout      →   (silent)         →    回到静默监听，用户无感
```

### 5.2 错误恢复决策表

| 场景 | 严重级别 | 自动恢复 | 用户感知 |
|------|---------|---------|---------|
| 单文件解析失败 | RECOVERABLE | 跳过，继续索引 | 索引报告中的1行 |
| 数据库损坏 | CRITICAL | 尝试repair，失败则重建 | 紧急通知 |
| 网络不通 | RECOVERABLE | 重试2次 | 降级提示+手动安装指引 |
| 语音超时 | TRANSIENT | 自动回到监听 | 呼吸灯变回Idle（用户可能未察觉） |
| 磁盘满 | CRITICAL | 无法恢复 | 紧急通知，引导清理 |
| Git仓库损坏 | RECOVERABLE | 跳过Git功能 | "变更历史不可用" |
| 意图无法解析 | RECOVERABLE | 反问澄清 | 歧义卡片 |
| 依赖安装部分失败 | RECOVERABLE | 继续，跳过失败包 | 警告+缺失列表 |

---

## 6. 配置与热加载

### 6.1 配置加载流程

```
App Start
    │
    ▼
读取 ~/.nodus/config.json
    │
    ├── 文件存在 → 解析 JSON → 验证 schema → NodusConfig
    │
    └── 文件不存在 → 生成默认配置 → 写入 config.json → NodusConfig
                                          │
                                          ▼
                                   各模块读取配置初始化
```

### 6.2 热加载支持

| 配置项 | 热加载 | 说明 |
|--------|--------|------|
| voice.silent_mode_default | ✓ | 切换时即时生效 |
| ui.theme | ✓ | 通过 event bus 通知 UI 重渲染 |
| ui.font_size | ✓ | 同上 |
| code_intelligence.exclude_patterns | ✗ | 需重建索引，应用重启后生效 |
| environment.proxy | ✗ | 依赖安装过程中不切换代理 |
| voice.wake_word | ✗ | 需重启语音管线 |

热加载机制：FileWatcher 监听 ~/.nodus/config.json → 检测变更 → 解析差异 → 通过 EventBus 发布 ConfigChanged 事件 → 相关模块响应。

---

## 7. 模块交互模式总结

```
┌─────────────────────────────────────────────────────────┐
│                    DIRECT CALL (Trait)                   │
│                                                         │
│  用于: 查询路径、同步操作、需要返回值的调用               │
│  特点: 编译期类型检查、零序列化开销、可mock测试            │
│                                                         │
│  示例: IntentEngine → ContextManager::snapshot()         │
│        IntentEngine → CodeIntelligence::query()          │
│        CodeIntelligence → KnowledgeStore::symbols_*()    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                    EVENT BUS (Pub/Sub)                   │
│                                                         │
│  用于: 生命周期通知、状态变更广播、异步任务触发           │
│  特点: 松耦合、一对多、fire-and-forget                   │
│                                                         │
│  示例: EnvReady → CodeIntel::index_project (spawn)      │
│        FileChanged → CodeIntel::index_file (spawn)      │
│        VoiceTranscribed → IntentEngine::parse → query   │
│        ContextChanged → CodeIntel::预加载相关索引        │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                    DEPENDENCY INJECTION                  │
│                                                         │
│  用于: 跨层能力调用、避免同层直接依赖                     │
│  特点: 显式参数、可替换实现、便于测试                     │
│                                                         │
│  示例: CodeIntel::change_history(scope, time, git: &dyn │
│         GitIntelligence) — git作为参数注入               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
