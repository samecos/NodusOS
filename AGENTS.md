# Nodus（结绳）— AI Agent 项目指南

> 本文件面向 AI 编码助手。阅读前请假设你对本项目一无所知；本文内容基于项目实际文件与运行结果整理，优先反映当前代码状态，而非设计文档中的愿景。

---

## 1. 项目概述

**Nodus（结绳）** 是一个面向开发者的 AI-Native 操作系统原型。当前阶段是一个运行在终端里的 Node.js CLI 应用：用户用自然语言（中英文）询问代码库，系统返回符号定义、引用、调用链路、影响范围、变更历史、代码统计等结构化结果。

一句话定义：**用说话的方式理解代码库。环境这件事不让人看见。**

当前 MVP 聚焦两块基石：

1. **语义代码索引（脑）**：基于 tree-sitter 抽取符号、引用、调用图、类型关系与代码统计。
2. **全托管环境（手）**：自动检测项目类型、运行时与依赖，并尝试安装。

> 重要：本项目不是编辑器替代品，定位是与 VSCode 等工具共存的“OS 层信息整合器”。

---

## 2. 技术栈与运行环境

| 层级 | 实际选用 | 说明 |
|------|----------|------|
| 运行时 | Node.js + TypeScript | `package.json` 要求 `>=20.0.0` |
| 模块系统 | ESM | `package.json` 中 `"type": "module"`，`tsconfig.json` 用 `nodenext` |
| 数据库 | SQLite via `better-sqlite3` | 本地嵌入式，无服务端 |
| 代码解析 | `tree-sitter` + 各语言 grammar | 支持 TS/JS/Python |
| 测试 | Vitest | 配置见 `vitest.config.ts` |
| 类型检查 | `tsc --noEmit` | 严格模式已开启 |
| 开发启动 | `tsx src/main.ts` | 见 `npm run dev` |

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

输入 `/quit` 或 `/exit` 退出。

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
├── tsconfig.json
├── vitest.config.ts
├── readme.md
└── AGENTS.md
```

### 3.2 `src/` 源码组织（按实际文件）

```
src/
├── main.ts                       # CLI 入口
├── common/                       # 共享基础设施
│   ├── types.ts                  # 核心共享类型（Symbol、Reference、CallGraph 等）
│   ├── config.ts                 # JSON 配置管理 + 热加载
│   ├── errors.ts                 # 统一错误类型与降级建议
│   ├── logger.ts                 # 文件日志系统
│   ├── config.test.ts
│   ├── errors.test.ts
│   ├── logger.test.ts
│   └── native-deps.test.ts
│
├── shell/                        # 外壳：事件总线 + 模块编排
│   ├── event-bus.ts              # 事件总线接口 + 标准事件类型
│   ├── event-bus.impl.ts         # SimpleEventBus 实现
│   ├── nodus-shell.ts            # NodusShell 主类
│   ├── event-bus.test.ts
│   └── nodus-shell.test.ts
│
├── context/                      # 上下文管理
│   ├── context-manager.ts
│   ├── context-manager.impl.ts
│   └── context-manager.test.ts
│
├── store/                        # 数据持久化（SQLite）
│   ├── knowledge-store.ts        # 存储层接口
│   ├── knowledge-store.impl.ts   # SqliteKnowledgeStore 实现
│   ├── migrations.ts             # 数据库迁移系统
│   ├── knowledge-store.test.ts
│   └── migrations.test.ts
│
├── code-intel/                   # 语义索引核心
│   ├── code-intelligence.ts      # 主接口与查询结果类型
│   ├── code-intelligence.impl.ts # CodeIntelligenceImpl 实现
│   ├── code-analytics.ts         # 代码库统计/分析接口
│   ├── code-analytics.impl.ts    # CodeAnalyticsImpl 实现
│   ├── language-parser.ts        # 语言解析器抽象
│   ├── reference-resolver.ts     # 跨文件引用解析
│   ├── module-resolver.ts        # 模块路径解析（tsconfig paths / index re-export）
│   ├── code-intelligence.test.ts
│   ├── code-intelligence.integration.test.ts
│   ├── code-analytics.test.ts
│   ├── type-relationship.test.ts
│   ├── reference-resolver.test.ts
│   ├── module-resolver.test.ts
│   └── parsers/
│       ├── typescript-parser.ts
│       ├── python-parser.ts
│       └── utils.ts
│
├── env-mgr/                      # 环境检测与安装
│   ├── environment-manager.ts
│   ├── environment-manager.impl.ts
│   └── environment-manager.test.ts
│
├── git-intel/                    # Git 操作封装
│   ├── git-intelligence.ts
│   ├── git-intelligence.impl.ts
│   └── git-intelligence.test.ts
│
├── file-watcher/                 # 文件监听（增量索引）
│   ├── file-watcher.ts
│   ├── file-watcher.impl.ts
│   └── file-watcher.test.ts
│
├── intent/                       # 意图解析（关键词 + 模式匹配）
│   ├── intent-engine.ts
│   ├── intent-engine.impl.ts
│   └── intent-engine.test.ts
│
├── ui/                           # 结果格式化（终端渲染器）
│   ├── ui-renderer.ts
│   ├── terminal-renderer.ts
│   └── terminal-renderer.test.ts
│
└── voice/                        # 语音管线（当前为 stub / 系统 TTS）
    ├── voice-pipeline.ts
    ├── voice-pipeline.impl.ts
    ├── audio-recorder.ts         # 录音接口
    ├── stt-engine.ts             # 语音转文字接口
    ├── wake-word-detector.ts     # 唤醒词接口
    └── voice-pipeline.test.ts
```

### 3.3 架构分层

实际代码遵循自上而下依赖的分层架构：

```
人机接口层
  └── 文本输入（main.ts REPL）/ TerminalRenderer / VoicePipeline（stub）

意图编排层
  └── IntentEngine / ContextManager / NodusShell

能力层
  ├── CodeIntelligence（tree-sitter 解析）
  ├── CodeAnalytics（统计、热点、耦合、死代码等）
  ├── EnvironmentManager（运行时/依赖）
  ├── GitIntelligence（git CLI 封装）
  └── FileWatcher（fs.watch + 事件总线）

数据层
  └── SqliteKnowledgeStore（SQLite 持久化）
```

模块通信方式：

1. **直接调用**（首选）：上层模块导入下层模块的接口并调用方法。
2. **事件总线**（松耦合）：通过 `SimpleEventBus` 收发 `NodusEvent` 标准事件，主要用于文件变更、索引状态、环境状态、配置变更等。
3. **禁止**：直接访问其他模块内部数据结构或实现类。

### 3.4 各模块实现状态（实际）

| 模块 | 接口 | 实现 | 单元测试 | 备注 |
|------|------|------|----------|------|
| ContextManager | ✅ | ✅ | ✅ | 完整可用 |
| KnowledgeStore | ✅ | ✅ | ✅ | SQLite 持久化 + 迁移 |
| EventBus | ✅ | ✅ | ✅ | 完整可用 |
| IntentEngine | ✅ | ✅ | ✅ | 关键词模式匹配 |
| TerminalRenderer | ✅ | ✅ | ✅ | 完整可用 |
| EnvironmentManager | ✅ | ✅ | ✅ | 会真实执行 `npm install` 等 |
| GitIntelligence | ✅ | ✅ | ✅ | 依赖本地 git CLI |
| FileWatcher | ✅ | ✅ | ✅ | Node.js `fs.watch` |
| CodeIntelligence | ✅ | ✅ | ✅ | tree-sitter 解析，含类型关系 |
| CodeAnalytics | ✅ | ✅ | ✅ | 统计/热点/耦合/死代码等 |
| ReferenceResolver | ✅ | ✅ | ✅ | 跨文件引用解析 |
| ModuleResolver | ✅ | ✅ | ✅ | tsconfig paths / re-export |
| VoicePipeline | ✅ | ✅ | ✅ | 仅麦克风检测 + 系统 TTS stub |
| NodusShell | ✅ | ✅ | ✅ | 生命周期与模块编排 |
| ConfigManager | ✅ | ✅ | ✅ | JSON 配置 + 热加载 |
| Logger | ✅ | ✅ | ✅ | 文件日志 |
| Errors | ✅ | ✅ | ✅ | 统一错误 + 降级建议 |

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

实际运行 `npm test` 的最近一次结果：

- **测试文件**：21 个
- **总测试数**：223 个
- **通过**：223 个
- **失败**：0 个

> 注意：`readme.md` 中测试数量描述可能与实际不一致；请以上述实测结果为准。原生依赖在新平台上仍可能加载失败，导致相关测试无法运行，需先执行 `npm run rebuild:native`。

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
- ESM + NodeNext 解析；`tsconfig.json` 中 `rootDir: src`，`outDir: dist`。
- 不允许隐式 `any`；优先用 `unknown` 并收窄。
- 导出的接口需带 JSDoc 注释。
- 源码与注释主要使用**中文**。

### 5.4 注释与文档语言

- 代码注释、JSDoc、`readme.md` 及 `docs/` 下文档主要使用**中文**。
- 接口文档（`ArchitecturalDesignPhase/04-API-Reference.md`）使用中文撰写但采用 Rust trait 风格描述。
- 类型、变量、函数名等技术标识符保持英文。

---

## 6. 测试策略

### 6.1 测试框架

使用 **Vitest**，配置：

- `globals: true`：全局 `describe` / `it` / `expect`。
- `environment: 'node'`。
- 匹配 `src/**/*.test.ts`。

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

### 6.4 当前测试覆盖

主要模块均已覆盖单元测试，包括：

- 共享层：`config`、`errors`、`logger`、`native-deps`
- 核心能力：`code-intelligence`、`code-analytics`、`reference-resolver`、`module-resolver`、`type-relationship`
- 编排与基础设施：`shell`、`event-bus`、`context`、`store`（含 migrations）
- 外部集成：`env-mgr`、`git-intel`、`file-watcher`
- 界面与交互：`ui`、`intent`、`voice`

---

## 7. 打包与部署

### 7.1 一键打包

`npm run package` 会：

1. 运行 `npm run build` 编译到 `dist/`。
2. 清理并创建 `bundle/` 目录。
3. 复制 `dist/` 到 `bundle/dist/`。
4. 生成精简版 `bundle/package.json`（移除 devDependencies 与 scripts）。
5. 在 `bundle/` 中执行 `npm install --omit=dev` 安装生产依赖。
6. 生成 Unix / Windows 可执行入口：`bundle/nodus` 与 `bundle/nodus.cmd`。

### 7.2 运行打包产物

```bash
npm run run:pkg
# 或
./bundle/nodus
# 或
node bundle/dist/main.js
```

> 注意：`better-sqlite3` 与 `tree-sitter` 包含原生二进制，打包产物与当前操作系统/架构绑定。若需分发到其他平台，请在目标平台上重新执行 `npm run package`。

---

## 8. 安全与注意事项

### 8.1 自动执行外部命令

`EnvironmentManagerImpl` 会调用 `execSync` 执行真实的外部命令：

- `node --version`、`python3 --version` 等运行时检测。
- `npm install`、`yarn install`、`pnpm install`、`pip install -r requirements.txt`、`poetry install`、`uv sync` 等依赖安装。
- 这些命令在项目根目录下运行，**会修改目标项目的文件系统**（创建 `node_modules` 等）。

### 8.2 Git 操作

`GitIntelligenceImpl` 通过 `execSync('git ...')` 执行 git 命令，依赖项目目录已是 git 仓库。

### 8.3 数据目录

`src/main.ts` 默认在 `~/.nodus/` 下创建 SQLite 数据库 `nodus.db`，并在 `intent-engine.impl.ts` 中向 `~/.nodus/feedback.jsonl` 追加反馈日志。`FileLogger` 默认写入 `~/.nodus/logs/nodus-YYYY-MM-DD.log`。

### 8.4 语音管线

`SystemVoicePipeline` 使用系统命令播放 TTS：

- macOS: `say`
- Linux: `espeak`
- Windows: PowerShell `System.Speech.Synthesis`

实时唤醒词 + STT 尚未实现，当前为接口与基础 TTS stub。

### 8.5 文件监听

`FileWatcherImpl` 使用 Node.js `fs.watch` 递归监听项目目录；变更会触发 `codeIntel.indexFile` 或数据库清理操作。

### 8.6 代码安全

- 不要在生产环境直接运行未知项目的 `npm install`。
- 当前实现没有沙箱；解析器会读取项目内任意源码文件。

---

## 9. 已知问题与限制

1. **原生二进制兼容性**：`better-sqlite3` 与 `tree-sitter` 的预编译二进制在某些平台上会加载失败。当前开发环境已通过 `npm run rebuild:native` 解决，但新环境仍需先运行 `npm run check:native` 验证。
2. **语音交互**：实时唤醒词 + STT 尚未实现，仅保留接口与基础 TTS stub。
3. **UI**：目前只有终端文本渲染器，没有图形界面。
4. **代码解析精度**：tree-sitter 解析器已能抽取符号与基本引用，并支持跨文件引用解析、类型关系、模块耦合等，但复杂动态调用、eval、宏等场景仍有局限。
5. **环境自动安装**：`installRuntime` 实际不会主动下载安装 Node/Python，而是检测现有运行时并打印提示；真正的全自动安装尚未实现。

---

## 10. 设计原则（来自项目文档）

六个核心原则（非协商）：

1. **意图驱动，而非指令驱动** —— 用户说“要什么”，系统决定“怎么做”。
2. **语音优先，界面为辅** —— 80% 操作应闭眼完成。
3. **系统适应人** —— 零学习成本，不同角色得到不同响应。
4. **全局上下文，无边界调度** —— 数据不在 App 孤岛里。
5. **主动计算，人授权限** —— 系统可预判，但不可越权。
6. **认知卸载，务实降级** —— 自动一切可自动的，做不到的诚实说明。

冲突解决顺序：**人授权限 > 主动计算 > 务实降级 > 体验一致性 > 语音优先 > 视觉呈现 > 系统适应人 > 功能完整度**。

---

## 11. 给 AI Agent 的操作建议

- 修改某个模块前，先阅读其 `<module>.ts` 接口定义，再看 `.impl.ts` 实现。
- 保持“接口 + 实现 + 测试”三件套结构；通用类型优先放到 `src/common/types.ts`。
- 测试用例建议沿用 `TC-UT-XXX-NNN` 编号风格。
- 涉及 `execSync` 或外部命令的改动要特别谨慎，避免破坏用户环境。
- 若你的工作涉及 `tree-sitter` 或 `better-sqlite3` 报错，先运行 `npm run check:native` 确认本地原生二进制可加载再继续。
- 修改配置相关逻辑时，同步检查 `src/common/config.test.ts`；修改数据库 schema 时，同步更新 `src/store/migrations.ts` 与 `src/store/migrations.test.ts`。
