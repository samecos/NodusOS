# Nodus（结绳）— AI Agent 项目指南

> 本文件面向 AI 编码助手。阅读前请假设你对本项目一无所知；本文内容基于项目实际文件与运行结果整理，优先反映当前代码状态，而非设计文档中的愿景。

---

## 1. 项目概述

**Nodus（结绳）** 是一个面向开发者的 AI-Native 操作系统原型。当前阶段是一个运行在终端里的 Node.js CLI 应用：用户用自然语言（中英文）询问代码库，系统返回符号定义、引用、调用链路、影响范围、变更历史、代码统计等结构化结果。

一句话定义：**用说话的方式理解代码库。环境这件事不让人看见。**

当前已实现的 CLI 能力覆盖：

1. **语义代码索引（脑）**：基于 tree-sitter 抽取符号、引用、调用图、类型关系与代码统计。
2. **代码分析**：死代码、模块耦合、变更热点、最长调用链、TODO 扫描、复杂度等。
3. **代码评审**：基于 Git diff + 符号索引生成风险/风格/bug 分级意见。
4. **代码生成与重构**：生成 git diff 形式的重构建议（已模块实现，尚未接入 REPL 主流程）。
5. **环境托管（手）**：自动检测项目类型、运行时、依赖与外部服务，并尝试安装。
6. **学习与同步**：查询历史、反馈学习、多设备同步、团队协作索引共享。
7. **理解层（人与 AI 代码产出对齐）**：作为旁观者监听 Git 变更，计算"理解债"热力图，按语义块生成简报卡，并捕获人工修正反哺为项目约定（`.nodus/conventions.md`），让 AI 工具越用越准。

> 重要：本项目不是编辑器替代品，定位是与 VSCode 等工具共存的"OS 层信息整合器"。

---

## 2. 技术栈与运行环境

| 层级 | 实际选用 | 说明 |
|------|----------|------|
| 运行时 | Node.js + TypeScript | `package.json` 要求 `>=20.0.0` |
| 模块系统 | ESM | `package.json` 中 `"type": "module"`，`tsconfig.json` 用 `nodenext` |
| 数据库 | SQLite via `better-sqlite3` | 本地嵌入式，无服务端 |
| 代码解析 | `tree-sitter` + 各语言 grammar | 当前支持 TS/JS/Python；插件框架已支持更多语言扩展 |
| 测试 | Vitest | 配置见 `vitest.config.ts` |
| 类型检查 | `tsc --noEmit` | 严格模式已开启 |
| 开发启动 | `tsx src/main.ts` | 见 `npm run dev` |
| 包管理器 | npm（主要） | `package.json` 脚本使用 npm；`package-lock.json` 与 `pnpm-lock.yaml` 被 `.gitignore` 忽略 |

### 2.1 入口与运行方式

入口文件为 `src/main.ts`：

```bash
# 安装依赖
npm install

# 检测关键原生依赖是否能正常加载（better-sqlite3 / tree-sitter 系列）
npm run check:native

# 启动并打开当前目录项目
npm run dev

# 启动并打开指定项目
npm run dev /path/to/your/project
```

启动后进入 REPL，输入自然语言查询，例如：

```
refundOrder在哪里定义的
PaymentService被哪些地方调用了
auth模块最近一周改了什么
项目代码统计
```

常用 REPL 命令：

| 命令 | 作用 |
|------|------|
| `/quit` 或 `/exit` | 退出 Nodus |
| `/help` | 显示可用命令与示例 |
| `/list` | 列出所有可调用的查询能力 |
| `/history [n]` | 查看最近 n 条查询历史（默认 10，最大 50） |
| `/learn` | 从 `~/.nodus/feedback.jsonl` 重新加载学习句式 |
| `/feedback <文本>` | 提交使用反馈 |
| `/switch <项目路径>` | 切换到指定项目 |
| `/list-projects` | 列出所有已配置的项目 |
| `/sync` | 导出多设备同步数据（JSON） |
| `/confirm <符号>` | 确认符号已审查完成（理解债清零） |
| `/prune [标签]` | 列出约定 / 删除指定约定（理解层飞轮） |
| *(空行)* | 显示推荐查询，输入序号即可执行 |

### 2.2 原生依赖与兼容性

项目依赖 `better-sqlite3` 与 `tree-sitter` 系列包，它们包含原生二进制（`.node`）。**在某些 macOS / Windows 环境上，预编译二进制可能因签名或架构问题无法加载**，表现为 `dlopen` 报错。

当前仓库在开发环境已可正常加载并通过全部测试。若在新机器上遇到加载失败：

```bash
npm run check:native    # 诊断
npm run rebuild:native  # 一键重新编译
npm run check:native    # 再次验证
```

`rebuild:native` 会依次重新编译 `better-sqlite3`、`tree-sitter`、`tree-sitter-typescript`、`tree-sitter-javascript`、`tree-sitter-python`。Windows 用户需按脚本提示手动逐条 `npm rebuild <pkg>` 执行。

---

## 3. 项目结构与模块划分

### 3.1 顶层目录

```
NodusOS/
├── src/                          # 源码
├── dist/                         # TypeScript 编译产物（gitignored）
├── bundle/                       # 一键打包产物（gitignored）
├── tests/fixtures/               # 测试夹具（如 tiny-project）
├── scripts/                      # 构建/检测/打包辅助脚本
├── docs/                         # 产品/架构文档（中文）
├── RequirementAnalysisPhase/     # 需求阶段文档
├── ArchitecturalDesignPhase/     # 架构阶段文档
├── TestDesignPhase/              # 测试设计文档
├── package.json
├── package-lock.json             # 被 gitignore 忽略
├── pnpm-lock.yaml                # 被 gitignore 忽略
├── tsconfig.json
├── vitest.config.ts
├── readme.md
└── AGENTS.md
```

### 3.2 `src/` 源码组织（按实际文件）

```
src/
├── main.ts                         # CLI 入口 / REPL 主循环
├── common/                         # 共享基础设施
│   ├── types.ts                    # 核心共享类型（Symbol、Reference、CallGraph、理解层类型等）
│   ├── config.ts                   # JSON 配置管理 + 热加载
│   ├── errors.ts                   # 统一错误类型与降级建议
│   ├── logger.ts                   # 文件日志系统
│   ├── config.test.ts
│   ├── errors.test.ts
│   ├── logger.test.ts
│   └── native-deps.test.ts         # 原生依赖加载测试（无对应 .ts 实现文件）
│
├── shell/                          # 外壳：事件总线 + 模块编排 + 缓存/推荐
│   ├── event-bus.ts                # 事件总线接口 + 标准事件类型
│   ├── event-bus.impl.ts           # SimpleEventBus 实现
│   ├── nodus-shell.ts              # NodusShell 主类，生命周期与事件路由
│   ├── query-cache.ts              # 查询结果缓存
│   ├── recommendation-engine.ts    # 查询推荐引擎
│   ├── event-bus.test.ts
│   ├── nodus-shell.test.ts
│   ├── query-cache.test.ts
│   └── recommendation-engine.test.ts
│
├── context/                        # 上下文追踪 — 项目、文件、光标、历史
│   ├── context-manager.ts
│   ├── context-manager.impl.ts
│   └── context-manager.test.ts
│
├── store/                          # 数据持久化（SQLite + 迁移）
│   ├── knowledge-store.ts          # 存储层接口
│   ├── knowledge-store.impl.ts     # SqliteKnowledgeStore 实现
│   ├── migrations.ts               # 数据库迁移系统（当前到 v6）
│   ├── knowledge-store.test.ts
│   └── migrations.test.ts
│
├── code-intel/                     # 语义索引核心
│   ├── code-intelligence.ts        # 主接口与查询结果类型
│   ├── code-intelligence.impl.ts   # CodeIntelligenceImpl 实现
│   ├── code-analytics.ts           # 代码库统计/分析接口
│   ├── code-analytics.impl.ts      # CodeAnalyticsImpl 实现
│   ├── reference-resolver.ts       # 跨文件引用解析
│   ├── module-resolver.ts          # 模块路径解析（tsconfig paths / index re-export）
│   ├── code-intelligence.test.ts
│   ├── code-intelligence.integration.test.ts
│   ├── code-analytics.test.ts
│   ├── type-relationship.test.ts
│   ├── reference-resolver.test.ts
│   ├── module-resolver.test.ts
│   └── parsers/
│       ├── plugin-system.ts        # 语言解析器插件注册表
│       ├── plugin-system.test.ts
│       ├── typescript-parser.ts
│       ├── python-parser.ts
│       └── utils.ts
│
├── code-gen/                       # AI 代码生成与重构（diff/refactor）
│   ├── code-generator.ts
│   ├── code-generator.impl.ts
│   └── code-generator.test.ts
│
├── code-review/                    # 代码评审助手
│   ├── code-reviewer.ts
│   ├── code-reviewer.impl.ts
│   └── code-reviewer.test.ts
│
├── debug/                          # 跨域调试（日志+代码关联）
│   ├── cross-domain-debugger.ts
│   ├── cross-domain-debugger.impl.ts
│   └── cross-domain-debugger.test.ts
│
├── collab/                         # 团队协作（索引共享 + 注释）
│   ├── team-collaboration.ts
│   ├── team-collaboration.impl.ts
│   └── team-collaboration.test.ts
│
├── sync/                           # 多设备同步
│   ├── device-sync.ts
│   ├── device-sync.impl.ts
│   └── device-sync.test.ts
│
├── env-mgr/                        # 环境管理 — 项目/运行时/依赖/外部服务检测
│   ├── environment-manager.ts
│   ├── environment-manager.impl.ts
│   └── environment-manager.test.ts
│
├── git-intel/                      # Git 操作 — log/diff/blame
│   ├── git-intelligence.ts
│   ├── git-intelligence.impl.ts
│   └── git-intelligence.test.ts
│
├── file-watcher/                   # 文件监听 — 增量索引
│   ├── file-watcher.ts
│   ├── file-watcher.impl.ts
│   └── file-watcher.test.ts
│
├── change-sensor/                  # 变更传感器 — 旁观监听 Git 工作树变更，打包 ChangeBatch
│   ├── change-sensor.ts
│   ├── change-sensor.impl.ts
│   └── change-sensor.test.ts
│
├── understanding-debt/             # 理解债引擎 — 债值计算/持久化/两态（examined/confirmed）切换
│   ├── debt-formula.ts             # 债值公式纯函数（debt = changeRecency × uncoveredRatio × difficulty）
│   ├── debt-engine.ts
│   ├── debt-engine.impl.ts
│   ├── debt-engine.test.ts
│   └── alignment-integration.test.ts
│
├── semantic-chunk/                 # 语义切片 — 按模块目录聚类变更符号 + 生成简报卡
│   ├── semantic-chunker.ts
│   ├── brief-template.ts
│   ├── semantic-chunker.impl.ts
│   └── semantic-chunker.test.ts
│
├── alignment/                      # 对齐飞轮 — 捕获人工修正 → 分类 tag → 反哺 conventions
│   ├── tag-classifier.ts           # diff → tag 启发式规则库（8 类）
│   ├── conventions-emitter.ts      # PluggableEmitter 接口
│   ├── alignment-flywheel.ts
│   ├── alignment-flywheel.impl.ts
│   ├── emitters/
│   │   └── nodus-md-emitter.ts     # .nodus/conventions.md 发射器
│   ├── tag-classifier.test.ts
│   └── alignment-flywheel.test.ts
│
├── overlay/                        # 叠加层 — 带行级债值标注的代码视图（P1 终端 / P2 编辑器）
│   ├── annotated-view.ts
│   └── annotated-view.test.ts
│
├── intent/                         # 意图引擎 — NLU 解析
│   ├── intent-engine.ts            # 接口与类型
│   ├── intent-engine.impl.ts       # PatternIntentEngine（正则 + 相似度回退）
│   ├── local-ml-intent-engine.ts   # 本地轻量神经网络意图分类器
│   ├── intent-engine.test.ts
│   └── local-ml-intent-engine.test.ts
│
├── ui/                             # 结果格式化与 UI 抽象
│   ├── ui-renderer.ts              # UI 渲染器接口（卡片、呼吸灯、历史等）
│   ├── terminal-renderer.ts        # 终端渲染实现
│   ├── code-snippet.ts             # 代码片段与高亮
│   ├── terminal-renderer.test.ts
│   └── code-snippet.test.ts
│
└── voice/                          # 语音管线 — 唤醒词 + 录音 + STT + TTS
    ├── voice-pipeline.ts
    ├── voice-pipeline.impl.ts
    ├── audio-recorder.ts           # 录音接口
    ├── stt-engine.ts               # 语音转文字接口
    ├── wake-word-detector.ts       # 唤醒词接口
    └── voice-pipeline.test.ts
```

### 3.3 架构分层

实际代码遵循自上而下依赖的分层架构：

```
人机接口层
  └── 文本输入（main.ts REPL）/ TerminalRenderer / VoicePipeline

意图编排层
  └── IntentEngine / ContextManager / NodusShell / QueryCache / RecommendationEngine

能力层
  ├── CodeIntelligence（tree-sitter 解析）
  ├── CodeAnalytics（统计、热点、耦合、死代码等）
  ├── CodeGenerator（代码生成与重构）
  ├── CodeReviewer（代码评审）
  ├── CrossDomainDebugger（日志+代码关联）
  ├── TeamCollaboration（索引共享/注释）
  ├── DeviceSync（多设备数据同步）
  ├── EnvironmentManager（运行时/依赖/外部服务）
  ├── GitIntelligence（git CLI 封装）
  └── FileWatcher（fs.watch + 事件总线）

理解层（人与 AI 代码产出对齐，旁观者，只读 Git/文件）
  ├── ChangeSensor（变更传感器：检测 → ChangeBatch）
  ├── DebtEngine（理解债：changeRecency × uncoveredRatio × difficulty 热力图）
  ├── SemanticChunker（语义切片：目录聚类 + 简报卡）
  ├── AlignmentFlywheel（修正捕获 → tag 分类 → conventions 反哺）
  └── AnnotatedView（带债值标注的代码视图）

数据层
  └── SqliteKnowledgeStore（SQLite 持久化 + 迁移系统）
```

模块通信方式：

1. **直接调用**（首选）：上层模块导入下层模块的接口并调用方法。
2. **事件总线**（松耦合）：通过 `SimpleEventBus` 收发 `NodusEvent` 标准事件，主要用于文件变更、索引状态、环境状态、配置变更、错误降级等。
3. **禁止**：直接访问其他模块内部数据结构或实现类。

### 3.4 各模块实现状态（实际）

| 模块 | 接口 | 实现 | 单元测试 | 备注 |
|------|------|------|----------|------|
| ContextManager | ✅ | ✅ | ✅ | 完整可用 |
| KnowledgeStore | ✅ | ✅ | ✅ | SQLite 持久化 + 迁移（v1–v6） |
| EventBus | ✅ | ✅ | ✅ | 完整可用 |
| IntentEngine | ✅ | ✅ | ✅ | 主流程为 PatternIntentEngine；LocalMLIntentEngine 已实现但未接入默认流程 |
| TerminalRenderer | ✅ | ✅ | ✅ | 完整可用 |
| CodeSnippet | ✅ | ✅ | ✅ | 代码片段与高亮 |
| EnvironmentManager | ✅ | ✅ | ✅ | 会真实执行 `npm install` 等 |
| GitIntelligence | ✅ | ✅ | ✅ | 依赖本地 git CLI |
| FileWatcher | ✅ | ✅ | ✅ | Node.js `fs.watch` |
| CodeIntelligence | ✅ | ✅ | ✅ | tree-sitter 解析，含类型关系 |
| CodeAnalytics | ✅ | ✅ | ✅ | 统计/热点/耦合/死代码等 |
| ReferenceResolver | ✅ | ✅ | ✅ | 跨文件引用解析 |
| ModuleResolver | ✅ | ✅ | ✅ | tsconfig paths / re-export |
| CodeGenerator | ✅ | ✅ | ✅ | 生成 diff，尚未接入 REPL 主流程 |
| CodeReviewer | ✅ | ✅ | ✅ | 已接入 REPL |
| CrossDomainDebugger | ✅ | ✅ | ✅ | 已实现，尚未接入 REPL 主流程 |
| TeamCollaboration | ✅ | ✅ | ✅ | 已实现，尚未接入 REPL 主流程 |
| DeviceSync | ✅ | ✅ | ✅ | 已实现；REPL `/sync` 已导出 |
| QueryCache | ✅ | ✅ | ✅ | 5 分钟查询缓存 |
| RecommendationEngine | ✅ | ✅ | ✅ | 上下文/高频/延续推荐 |
| VoicePipeline | ✅ | ✅ | ✅ | 能量阈值唤醒 + 系统 TTS；实时 STT 为 stub |
| ChangeSensor | ✅ | ✅ | ✅ | 已接入理解层 REPL 流程 |
| DebtEngine | ✅ | ✅ | ✅ | 已接入理解层 REPL 流程 |
| SemanticChunker | ✅ | ✅ | ✅ | 已接入理解层 REPL 流程 |
| AlignmentFlywheel | ✅ | ✅ | ✅ | 已接入理解层 REPL 流程 |
| AnnotatedView | n/a | ✅ | ✅ | 纯函数渲染，已接入 REPL |
| NodusShell | ✅ | ✅ | ✅ | 生命周期与模块编排 |
| ConfigManager | ✅ | ✅ | ✅ | JSON 配置 + 热加载 |
| Logger | ✅ | ✅ | ✅ | 文件日志 |
| Errors | ✅ | ✅ | ✅ | 统一错误 + 降级建议 |

> 注：理解层 P1（ChangeSensor/DebtEngine/SemanticChunker/AlignmentFlywheel/AnnotatedView）已实现并接入 REPL。P2 增强（编辑器叠加层 LSP、飞轮自动捕获、债值校准、调用图聚类等）尚未实现，详见 `readme.md` 与 `docs/superpowers/` 下设计文档。

---

## 4. 构建、运行与测试命令

```bash
# 安装依赖
npm install

# 检测原生依赖是否能正常加载
npm run check:native

# 重新编译原生依赖
npm run rebuild:native

# 运行全部测试
npm test

# 监听模式（TDD）
npm run test:watch

# 测试覆盖率
npm run test:coverage

# TypeScript 类型检查
npm run typecheck

# 开发模式启动
npm run dev

# 启动并打开指定项目
npm run dev /path/to/project

# 编译 TypeScript 到 dist/
npm run build

# 一键打包：编译 + 复制产物 + 安装生产依赖到 bundle/
npm run package

# 运行打包结果
npm run run:pkg
```

### 4.1 当前测试结果

实际运行 `npm test` 的最近一次结果（38 个测试文件 / 459 个测试，全部通过，`npm run typecheck` 无报错）：

- **测试文件**：38 个
- **总测试数**：459 个
- **通过**：459 个
- **失败**：0 个

> 原生依赖在新平台上仍可能加载失败，导致相关测试无法运行，需先执行 `npm run rebuild:native`。

---

## 5. 代码规范与约定

### 5.1 模块文件模式

每个模块尽量保持统一结构：

```
src/<module>/
├── <module>.ts                 # 接口定义
├── <module>.impl.ts            # 默认实现
├── <module>.test.ts            # 单元测试
└── <module>.integration.test.ts  # 集成测试（如有）
```

通用共享代码统一放在 `src/common/` 下。

### 5.2 命名规范

- **接口**：PascalCase，**不加 `I` 前缀**，例如 `ContextManager`、`KnowledgeStore`。
- **实现类**：`Default` / 技术前缀 / `Impl` 后缀，例如 `DefaultContextManager`、`SqliteKnowledgeStore`、`CodeIntelligenceImpl`、`PatternIntentEngine`。
- **类型**：PascalCase，统一放在 `src/common/types.ts`；模块专属类型可放在对应模块接口文件中。
- **文件**：kebab-case，例如 `context-manager.ts`、`knowledge-store.impl.ts`。
- **测试文件**：与实现文件同名加 `.test.ts`。

### 5.3 TypeScript 规范

- 严格模式已开启（`"strict": true`）。
- `verbatimModuleSyntax: true`：类型导入必须写 `import type { ... }`。
- ESM + NodeNext 解析；`tsconfig.json` 中 `rootDir: src`，`outDir: dist`；`tsconfig.json` 用 `exclude: ["src/**/*.test.ts"]` 排除测试文件。
- 不允许隐式 `any`；优先用 `unknown` 并收窄。
- 导出的接口需带 JSDoc 注释。
- 源码与注释主要使用**中文**。

### 5.4 注释与文档语言

- 代码注释、JSDoc、`readme.md` 及 `docs/` 下文档主要使用**中文**。
- 接口文档（`ArchitecturalDesignPhase/04-API-Reference.md`）使用中文撰写但采用 Rust trait 风格描述。
- 类型、变量、函数名等技术标识符保持英文。

### 5.5 ESM 导入路径

由于使用 `verbatimModuleSyntax` 与 NodeNext，所有相对导入必须带 `.js` 扩展名（即便源码是 `.ts`），例如 `import { SimpleEventBus } from './event-bus.impl.js';`。新增文件时务必遵循。

---

## 6. 测试策略

### 6.1 测试框架

使用 **Vitest**，配置：

- `globals: true`：全局 `describe` / `it` / `expect`。
- `environment: 'node'`。
- `include: ['src/**/*.test.ts']`。

### 6.2 测试文件约定

- 单元测试：`src/<module>/<name>.test.ts`
- 集成测试：`src/<module>/<name>.integration.test.ts`
- 测试用例命名通常带 `TC-UT-XXX-NNN` 编号，例如 `TC-UT-CM-001: should have correct initial state`。

### 6.3 测试隔离

- 需要文件系统的测试使用 `os.tmpdir()` 创建临时目录，并在 `afterEach` 中清理。
- `KnowledgeStore` 相关测试优先使用 `:memory:` 内存数据库。
- `GitIntelligence` 测试会在临时目录 `git init` 真实仓库。
- `ConfigManager` 测试使用临时配置文件并在结束时清理。
- `EnvironmentManager` 测试会真实调用 `node --version` 等外部命令，但不会实际安装依赖（使用 mock 或 dry-run）。
- 测试夹具位于 `tests/fixtures/`（如 `tiny-project`，一个最小 TypeScript 项目供集成测试使用）。

### 6.4 当前测试覆盖

主要模块均已覆盖单元测试，包括：

- 共享层：`config`、`errors`、`logger`、`native-deps`
- 核心能力：`code-intelligence`、`code-analytics`、`reference-resolver`、`module-resolver`、`type-relationship`
- 编排与基础设施：`shell`、`event-bus`、`context`、`store`（含 migrations）、`query-cache`、`recommendation-engine`
- 扩展能力：`code-gen`、`code-review`、`debug`、`collab`、`sync`
- 外部集成：`env-mgr`、`git-intel`、`file-watcher`
- 理解层：`change-sensor`、`understanding-debt`（含 `debt-engine` + `alignment-integration`）、`semantic-chunk`、`alignment`（含 `tag-classifier` + `flywheel`）、`overlay`
- 界面与交互：`ui`、`intent`、`voice`

---

## 7. 数据层与迁移

### 7.1 SQLite 模式

`SqliteKnowledgeStore` 通过 `MigrationRunner` 管理 schema。迁移定义在 `src/store/migrations.ts`，当前到 v6：

- **v1** `initial_schema`：`symbols`、`refs`、`callgraphs`、`projects`、`project_runtimes`、`project_dependencies`、`file_index_state`、`preferences`、`query_history`、`annotations` 及各类索引。
- **v2** `add_session_state`：`session_state` 表（恢复项目/文件/光标位置）。
- **v3** `add_annotations_table`：`annotations` 表（训练标注飞轮）。
- **v4** `add_debt_entries`：`debt_entries` 表（理解债热力图）。
- **v5** `add_code_annotations`：`code_annotations` 表（人工修正标注）。
- **v6** `add_conventions`：`conventions` 表（对齐飞轮约定模式）。

### 7.2 修改 schema 的约定

新增或变更数据库表时，必须：

1. 在 `MIGRATIONS` 数组追加一条 `{ version, name, up }`（version 递增）。
2. 同步更新 `src/store/migrations.test.ts` 验证新迁移可应用。
3. 在 `KnowledgeStore` 接口与实现中补充对应的读写方法。

---

## 8. 打包与部署

### 8.1 一键打包

`npm run package`（由 `scripts/package.js` 执行）会：

1. 运行 `npm run build` 编译到 `dist/`。
2. 清理并创建 `bundle/` 目录。
3. 复制 `dist/` 到 `bundle/dist/`。
4. 生成精简版 `bundle/package.json`（移除 devDependencies 与 scripts）。
5. 在 `bundle/` 中执行 `npm install --omit=dev --no-audit --no-fund` 安装生产依赖。
6. 生成 Unix（`bundle/nodus`，chmod 755）与 Windows（`bundle/nodus.cmd`）可执行入口。

### 8.2 运行打包产物

```bash
npm run run:pkg
# 或
./bundle/nodus
# 或
node bundle/dist/main.js
```

> 注意：`better-sqlite3` 与 `tree-sitter` 包含原生二进制，打包产物与当前操作系统/架构绑定。若需分发到其他平台，请在目标平台上重新执行 `npm run package`。

---

## 9. 安全与注意事项

### 9.1 自动执行外部命令

`EnvironmentManagerImpl` 会调用 `execSync` 执行真实的外部命令：

- `node --version`、`python3 --version` 等运行时检测。
- `npm install`、`yarn install`、`pnpm install`、`pip install -r requirements.txt`、`poetry install`、`uv sync` 等依赖安装。
- `docker compose up`、`redis-server`、`pg_ctl start` 等外部服务启动建议/命令。
- 这些命令在项目根目录下运行，**会修改目标项目的文件系统**（创建 `node_modules` 等）。

### 9.2 Git 操作

`GitIntelligenceImpl` 通过 `execSync('git ...')` 执行 git 命令，依赖项目目录已是 git 仓库。`ChangeSensor` 同样通过 Git（`git diff --name-only HEAD` + `git ls-files --others`）检测工作树变更，只读不写。

### 9.3 数据目录

`src/main.ts` 默认在 `~/.nodus/` 下创建（用户级）：

| 路径 | 用途 |
|------|------|
| `~/.nodus/nodus.db` | SQLite 知识库 |
| `~/.nodus/config.json` | 用户配置 |
| `~/.nodus/logs/nodus-YYYY-MM-DD.log` | 运行日志 |
| `~/.nodus/feedback.jsonl` | 用户反馈记录（意图学习闭环） |
| `~/.nodus/ml-intent-model.json` | 本地轻量意图模型 |

项目级数据写入目标项目根目录：

| 路径 | 用途 |
|------|------|
| `.nodus/conventions.md` | 项目约定（对齐飞轮自动生成，反喂 AI 工具） |

### 9.4 语音管线

`SystemVoicePipeline` 使用系统命令播放 TTS：

- macOS: `say`
- Linux: `espeak`
- Windows: PowerShell `System.Speech.Synthesis`

实时唤醒词 + STT 尚未完全实现，当前为能量阈值触发 + 接口 stub。

### 9.5 文件监听

`FileWatcherImpl` 使用 Node.js `fs.watch` 递归监听项目目录；变更会触发 `codeIntel.indexFile` 或数据库清理操作。

### 9.6 代码安全

- 不要在生产环境直接运行未知项目的 `npm install`。
- 当前实现没有沙箱；解析器会读取项目内任意源码文件。
- 多设备同步数据包包含查询历史与项目路径，导出/导入时注意隐私。

---

## 10. 已知问题与限制

1. **原生二进制兼容性**：`better-sqlite3` 与 `tree-sitter` 的预编译二进制在某些平台上会加载失败。当前开发环境已通过 `npm run rebuild:native` 解决，但新环境仍需先运行 `npm run check:native` 验证。
2. **语音交互**：实时唤醒词 + STT 尚未完全实现，仅保留接口与基础 TTS。
3. **UI**：目前只有终端文本渲染器，没有图形界面。
4. **代码解析精度**：tree-sitter 解析器已能抽取符号与基本引用，并支持跨文件引用解析、类型关系、模块耦合等，但复杂动态调用、eval、宏等场景仍有局限。
5. **环境自动安装**：`installRuntime` 实际不会主动下载安装 Node/Python，而是检测现有运行时并打印提示；真正的全自动安装尚未实现。
6. **部分新能力未接入 REPL**：`CodeGenerator`、`CrossDomainDebugger`、`TeamCollaboration` 已模块实现，但尚未通过自然语言在 REPL 主流程中触发；可通过编程方式调用。
7. **理解层 P1 简化**：债值计算中 `blastRadius` 当前硬编码 0.5（新鲜变更 debt < 1.0），需多批次累积或接入 ImpactAnalysis 后才有梯度；聚类用目录代替调用图连通分量；飞轮自动捕获依赖 FileWatcher + 保存静默窗口，尚未接入，当前为被动触发。完整设计与 P2 待办见 `readme.md` 与 `docs/superpowers/specs/`。

---

## 11. 设计原则（来自项目文档）

六个核心原则（非协商）：

1. **意图驱动，而非指令驱动** —— 用户说"要什么"，系统决定"怎么做"。
2. **语音优先，界面为辅** —— 80% 操作应闭眼完成。
3. **系统适应人** —— 零学习成本，不同角色得到不同响应。
4. **全局上下文，无边界调度** —— 数据不在 App 孤岛里。
5. **主动计算，人授权限** —— 系统可预判，但不可越权。
6. **认知卸载，务实降级** —— 自动一切可自动的，做不到的诚实说明。

冲突解决顺序：**人授权限 > 主动计算 > 务实降级 > 体验一致性 > 语音优先 > 视觉呈现 > 系统适应人 > 功能完整度**。

---

## 12. 给 AI Agent 的操作建议

- 修改某个模块前，先阅读其 `<module>.ts` 接口定义，再看 `.impl.ts` 实现。
- 保持"接口 + 实现 + 测试"三件套结构；通用类型优先放到 `src/common/types.ts`。
- 测试用例建议沿用 `TC-UT-XXX-NNN` 编号风格。
- 涉及 `execSync` 或外部命令的改动要特别谨慎，避免破坏用户环境。
- 若你的工作涉及 `tree-sitter` 或 `better-sqlite3` 报错，先运行 `npm run check:native` 确认本地原生二进制可加载再继续。
- 修改配置相关逻辑时，同步检查 `src/common/config.test.ts`；修改数据库 schema 时，同步更新 `src/store/migrations.ts` 与 `src/store/migrations.test.ts`（参考第 7 节）。
- 新增语言解析器时，应通过 `src/code-intel/parsers/plugin-system.ts` 注册，并补充对应测试。
- 修改 `NodusShell` 生命周期或事件路由时，同步检查 `src/shell/nodus-shell.test.ts` 与 `src/main.ts`。
- 所有相对导入必须带 `.js` 扩展名（ESM + NodeNext + `verbatimModuleSyntax` 要求）。
- 改完代码后跑 `npm run typecheck` 与 `npm test` 验证；前者检查类型，后者覆盖功能回归。
