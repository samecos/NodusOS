# Nodus（结绳）— AI Agent 项目指南

> 本文件面向 AI 编码助手。阅读前请假设你对本项目一无所知；本文内容基于项目实际文件与运行结果整理，优先反映当前代码状态，而非设计文档中的愿景。

---

## 1. 项目概述

**Nodus（结绳）** 是一个面向开发者的 AI-Native 操作系统原型。当前阶段是一个运行在终端里的 Node.js CLI 应用：用户用自然语言（中英文）询问代码库，系统返回符号定义、引用、调用链路、影响范围、变更历史等结构化结果。

一句话定义：**用说话的方式理解代码库。环境这件事不让人看见。**

当前 MVP 聚焦两块基石：

1. **语义代码索引（脑）**：基于 tree-sitter 抽取符号、引用、调用图。
2. **全托管环境（手）**：自动检测项目类型、运行时与依赖，并尝试安装。

> 重要：本项目不是编辑器替代品，定位是与 VSCode 等工具共存的“OS 层信息整合器”。

---

## 2. 技术栈与运行环境

| 层级 | 实际选用 | 说明 |
|------|----------|------|
| 运行时 | Node.js + TypeScript | 当前唯一实现语言 |
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
```

输入 `/quit` 或 `/exit` 退出。

### 2.2 原生依赖警告

项目依赖 `better-sqlite3` 与 `tree-sitter` 两个带原生二进制（`.node`）的 npm 包。**在某些 macOS 环境上，这些预编译二进制可能因签名/架构问题无法加载**，导致知识存储与代码解析相关测试无法运行。实际运行前若遇到 `dlopen` 报错，通常需要重新从源码编译这两个包（`npm rebuild` 或参照各包官方文档处理）。

---

## 3. 项目结构与模块划分

### 3.1 顶层目录

```
NodusOS/
├── src/                          # 源码
├── tests/fixtures/               # 测试夹具（如 tiny-project）
├── docs/                         # 产品/架构文档（中文）
├── RequirementAnalysisPhase/     # 需求阶段文档
├── ArchitecturalDesignPhase/     # 架构阶段文档
├── TestDesignPhase/              # 测试阶段文档
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── readme.md
```

### 3.2 `src/` 源码组织（按实际文件）

```
src/
├── main.ts                       # CLI 入口
├── common/types.ts               # 核心共享类型（Symbol、Reference、CallGraph 等）
│
├── shell/                        # 外壳：事件总线 + 模块编排
│   ├── event-bus.ts              # 事件总线接口
│   ├── event-bus.impl.ts         # SimpleEventBus 实现
│   ├── nodus-shell.ts            # NodusShell 主类
│   └── nodus-shell.test.ts
│
├── context/                      # 上下文管理
│   ├── context-manager.ts
│   ├── context-manager.impl.ts
│   └── context-manager.test.ts
│
├── store/                        # 数据持久化（SQLite）
│   ├── knowledge-store.ts
│   ├── knowledge-store.impl.ts
│   └── knowledge-store.test.ts
│
├── code-intel/                   # 语义索引核心
│   ├── code-intelligence.ts
│   ├── code-intelligence.impl.ts
│   ├── code-intelligence.test.ts           # 当前为空（导入 tree-sitter 即报错）
│   ├── code-intelligence.integration.test.ts  # 当前为空
│   ├── language-parser.ts
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
└── voice/                        # 语音管线（当前为 stub）
    ├── voice-pipeline.ts
    └── voice-pipeline.impl.ts
```

### 3.3 架构分层

实际代码遵循自上而下依赖的分层架构：

```
人机接口层
  └── 文本输入 / TerminalRenderer / VoicePipeline（stub）

意图编排层
  └── IntentEngine / ContextManager

能力层
  ├── CodeIntelligence（tree-sitter 解析）
  ├── EnvironmentManager（运行时/依赖）
  ├── GitIntelligence（git CLI 封装）
  └── FileWatcher（fs.watch + 事件总线）

数据层
  └── SqliteKnowledgeStore（SQLite 持久化）
```

模块通信方式：

1. **直接调用**（首选）：上层模块导入下层模块的接口并调用方法。
2. **事件总线**（松耦合）：通过 `SimpleEventBus` 收发事件，主要用于文件变更、索引状态、环境状态等。
3. **禁止**：直接访问其他模块内部数据结构或实现类。

### 3.4 各模块实现状态（实际）

| 模块 | 接口 | 实现 | 单元测试 | 备注 |
|------|------|------|----------|------|
| ContextManager | ✅ | ✅ | ✅ 7 个 | 完整可用 |
| KnowledgeStore | ✅ | ✅ | ⚠️ 15 个失败 | 因 better-sqlite3 二进制问题 |
| EventBus | ✅ | ✅ | ✅ 5 个 | 完整可用 |
| IntentEngine | ✅ | ✅ | ✅ 10 个 | 关键词模式匹配 |
| TerminalRenderer | ✅ | ✅ | ✅ 6 个 | 完整可用 |
| EnvironmentManager | ✅ | ✅ | ✅ 8 个 | 会真实执行 `npm install` 等 |
| GitIntelligence | ✅ | ✅ | ✅ 5 个 | 依赖本地 git CLI |
| FileWatcher | ✅ | ✅ | ✅ 3 个 | Node.js `fs.watch` |
| CodeIntelligence | ✅ | ✅ | ⚠️ 0 个运行 | 因 tree-sitter 二进制问题 |
| VoicePipeline | ✅ | ✅ | 无 | 仅麦克风检测 + TTS stub |
| NodusShell | ✅ | ✅ | ⚠️ 0 个运行 | 因 tree-sitter 加载失败 |

---

## 4. 构建、运行与测试命令

```bash
# 安装依赖
npm install

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
```

### 4.1 当前测试结果的真实情况

最后一次运行结果：

- **测试文件**：11 个
- **总测试数**：59 个
- **通过**：44 个
- **失败**：15 个（全部来自 `src/store/knowledge-store.test.ts`，根因是 `better-sqlite3` 原生二进制加载失败）
- **无法运行的套件**：`code-intelligence.test.ts`、`code-intelligence.integration.test.ts`、`nodus-shell.test.ts`（根因是 `tree-sitter` 原生二进制加载失败）

> 注意：`readme.md` 中“71 个测试，全绿”的描述与当前实际状态不符；请以上述实测结果为准。

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

### 5.2 命名规范

- **接口**：PascalCase，**不加 `I` 前缀**，例如 `ContextManager`、`KnowledgeStore`。
- **实现类**：`Default` / 技术前缀 / `Impl` 后缀，例如 `DefaultContextManager`、`SqliteKnowledgeStore`、`CodeIntelligenceImpl`。
- **类型**：PascalCase，统一放在 `src/common/types.ts`。
- **文件**：kebab-case，例如 `context-manager.ts`、`knowledge-store.impl.ts`。
- **测试文件**：与实现文件同名加 `.test.ts`。

### 5.3 TypeScript 规范

- 严格模式已开启（`"strict": true`）。
- `verbatimModuleSyntax: true`：类型导入必须写 `import type { ... }`。
- ESM + NodeNext 解析。
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
- `KnowledgeStore` 测试使用 `:memory:` 内存数据库。
- `GitIntelligence` 测试会在临时目录 `git init` 真实仓库。

### 6.4 当前测试缺口

- `code-intelligence.test.ts` 与 `code-intelligence.integration.test.ts` 当前为空文件（只有导入，没有测试体），原因是 tree-sitter 原生模块加载失败。
- 语音管线没有测试。

---

## 7. 安全与注意事项

### 7.1 自动执行外部命令

`EnvironmentManagerImpl` 会调用 `execSync` 执行真实的外部命令：

- `node --version`、`python3 --version` 等运行时检测。
- `npm install`、`yarn install`、`pnpm install`、`pip install -r requirements.txt`、`poetry install`、`uv sync` 等依赖安装。
- 这些命令在项目根目录下运行，**会修改目标项目的文件系统**（创建 `node_modules` 等）。

### 7.2 Git 操作

`GitIntelligenceImpl` 通过 `execSync('git ...')` 执行 git 命令，依赖项目目录已是 git 仓库。

### 7.3 数据目录

`src/main.ts` 默认在 `~/.nodus/` 下创建 SQLite 数据库 `nodus.db`，并在 `intent-engine.impl.ts` 中向 `~/.nodus/feedback.jsonl` 追加反馈日志。

### 7.4 语音管线

`SystemVoicePipeline` 使用系统命令播放 TTS：

- macOS: `say`
- Linux: `espeak`
- Windows: PowerShell `System.Speech.Synthesis`

### 7.5 文件监听

`FileWatcherImpl` 使用 Node.js `fs.watch` 递归监听项目目录；变更会触发 `codeIntel.indexFile` 或数据库清理操作。

### 7.6 代码安全

- 不要在生产环境直接运行未知项目的 `npm install`。
- 当前实现没有沙箱；解析器会读取项目内任意源码文件。

---

## 8. 已知问题与限制

1. **原生二进制兼容性**：`better-sqlite3` 与 `tree-sitter` 的预编译二进制在某些平台上会加载失败，导致存储与代码解析相关功能不可用。需要按平台重新编译或调整依赖。
2. **测试状态**：当前无法达到 `readme.md` 中声称的“71 个测试全绿”。
3. **语音交互**：实时唤醒词 + STT 尚未实现，仅保留接口与基础 TTS stub。
4. **UI**：目前只有终端文本渲染器，没有图形界面。
5. **代码解析精度**：tree-sitter 解析器已能抽取符号与基本引用，但跨文件引用解析、类型引用、继承关系等仍有大量细节待完善。
6. **环境自动安装**：`installRuntime` 实际不会主动下载安装 Node/Python，而是检测现有运行时并打印提示；真正的全自动安装尚未实现。

---

## 9. 设计原则（来自项目文档）

六个核心原则（非协商）：

1. **意图驱动，而非指令驱动** —— 用户说“要什么”，系统决定“怎么做”。
2. **语音优先，界面为辅** —— 80% 操作应闭眼完成。
3. **系统适应人** —— 零学习成本，不同角色得到不同响应。
4. **全局上下文，无边界调度** —— 数据不在 App 孤岛里。
5. **主动计算，人授权限** —— 系统可预判，但不可越权。
6. **认知卸载，务实降级** —— 自动一切可自动的，做不到的诚实说明。

冲突解决顺序：**人授权限 > 主动计算 > 务实降级 > 体验一致性 > 语音优先 > 视觉呈现 > 系统适应人 > 功能完整度**。

---

## 10. 给 AI Agent 的操作建议

- 修改某个模块前，先阅读其 `<module>.ts` 接口定义，再看 `.impl.ts` 实现。
- 保持“接口 + 实现 + 测试”三件套结构。
- 新类型优先放到 `src/common/types.ts`。
- 测试用例建议沿用 `TC-UT-XXX-NNN` 编号风格。
- 涉及 `execSync` 或外部命令的改动要特别谨慎，避免破坏用户环境。
- 若你的工作涉及 `tree-sitter` 或 `better-sqlite3` 报错，先确认本地原生二进制可加载再继续。
