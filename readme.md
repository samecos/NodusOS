# Nodus (结绳)

AI-Native Operating System for Developers.  
用说话的方式理解代码库。环境这件事不让人看见。

## Quick Start

```bash
# 安装依赖
npm install

# 检测原生依赖是否能正常加载
npm run check:native

# 运行测试
npm test

# 启动 Nodus，打开当前目录的项目
npm run dev

# 打开指定项目
npm run dev /path/to/your/typescript-or-python-project
```

启动后直接在终端输入自然语言查询：

```
Nodus is ready. Type a query or /quit to exit.

refundOrder在哪里定义的
PaymentService被哪些地方调用了
auth模块最近一周改了什么
```

输入 `/quit` 退出。

## 支持的查询类型

| 你想问的 | 这样说 |
|---------|--------|
| 函数/类定义在哪 | `refundOrder在哪里定义的` |
| 谁调用了这个函数 | `refundOrder被哪些地方调用了` |
| 完整调用链路 | `refundOrder的调用链路是什么样的` |
| 改了会有什么影响 | `如果我改了User模型，哪些文件会受影响` |
| 模块最近改了什么 | `auth模块最近一周改了什么` |
| 文件里有什么 | `payment.service.ts里有哪些函数` |
| 列出导出函数 | `列出所有导出的函数` |
| 代码库统计 | `项目代码统计` |
| 最热函数 | `调用次数最多的函数` |
| 死代码检测 | `有哪些未使用的导出` |
| 变更热点 | `变更热点文件` |
| TODO 扫描 | `项目里有哪些 TODO` |
| 模块耦合度 | `模块耦合度` |
| 最长调用链 | `最长调用链` |

支持中英文，支持同义改写。例如“改动 refundOrder 会影响哪些地方”“refundOrder 的影响范围”也能识别为影响分析。

支持 TypeScript、JavaScript、Python 项目。

## 使用方法

### 启动与项目加载

```bash
# 进入 NodusOS 目录并安装依赖
cd /path/to/NodusOS
npm install

# 方式一：打开当前目录作为目标项目
npm run dev

# 方式二：打开指定项目
npm run dev /path/to/your/project
```

首次启动时，Nodus 会：

1. 在 `~/.nodus/` 创建配置、日志与 SQLite 数据库。
2. 自动检测目标项目类型（TypeScript / JavaScript / Python）。
3. 递归扫描项目源码，建立语义索引（符号、引用、调用图）。

### 交互式查询

启动后进入 REPL，直接输入自然语言：

```
Nodus is ready. Type a query or /quit to exit.

> refundOrder在哪里定义的
> PaymentService被哪些地方调用了
> 如果我改了User模型，哪些文件会受影响
> auth模块最近一周改了什么
> 项目代码统计
```

支持中英文混合输入。若系统对意图识别不确定，会列出最匹配的几种解释供你选择。

### 常用命令

在 REPL 中输入以下命令：

| 命令 | 作用 |
|------|------|
| `/quit` 或 `/exit` | 退出 Nodus |
| `/help` | 显示可用命令与示例 |
| `/history` | 查看本次会话的查询历史 |
| `/feedback <文本>` | 提交使用反馈，保存到 `~/.nodus/feedback.jsonl` |

### 配置文件

Nodus 在 `~/.nodus/config.json` 中维护配置，启动时自动加载。示例：

```json
{
  "projectPath": "/path/to/your/project",
  "dbPath": "~/.nodus/nodus.db",
  "language": "zh",
  "voice": {
    "enabled": false,
    "wakeWord": "结绳"
  },
  "indexing": {
    "excludePatterns": ["node_modules", ".git", "dist", "build"],
    "maxFileSizeBytes": 1048576
  }
}
```

修改配置后，下次启动生效（部分配置支持热重载）。

### 日志与数据目录

| 路径 | 用途 |
|------|------|
| `~/.nodus/nodus.db` | SQLite 知识库 |
| `~/.nodus/config.json` | 用户配置 |
| `~/.nodus/logs/` | 运行日志 |
| `~/.nodus/feedback.jsonl` | 用户反馈记录 |

### 构建与打包

```bash
# 编译 TypeScript 到 dist/
npm run build

# 一键打包：编译 + 复制产物 + 安装生产依赖到 bundle/
npm run package

# 一键运行打包结果
npm run run:pkg

# 或直接运行 bundle 中的入口
node bundle/dist/main.js
./bundle/nodus
```

打包后生成 `bundle/` 目录，结构如下：

```
bundle/
├── dist/              # 编译后的 JS
├── node_modules/      # 生产依赖（含 better-sqlite3、tree-sitter 等原生模块）
├── nodus              # Unix 可执行入口
├── nodus.cmd          # Windows 可执行入口
└── package.json
```

> 注意：由于 `better-sqlite3` 与 `tree-sitter` 包含原生二进制，打包产物与当前操作系统/架构绑定。若需分发到其他平台，请在目标平台上重新执行 `npm run package`。

### 注意事项

- Nodus 目前定位为 VSCode 等编辑器的补充，不是编辑器替代品。
- 环境自动安装功能会检测现有运行时（Node / Python），但不会主动下载安装；若未检测到，会给出安装提示。
- 代码解析基于 tree-sitter，复杂类型引用、跨文件动态调用等场景仍在持续完善。
- 若遇到 `better-sqlite3` 或 `tree-sitter` 的 `dlopen` 报错，请参考下方“原生依赖兼容性”章节重新编译。

## Project Structure

```
src/
├── main.ts                         # 入口点
├── common/types.ts                 # 核心类型定义 (30+)
│
├── store/                          # 数据层 — SQLite 持久化
│   └── knowledge-store.ts
├── context/                        # 上下文追踪 — 文件、光标、历史
│   └── context-manager.ts
├── shell/                          # 外壳 — 事件总线 + 模块编排
│   ├── event-bus.ts
│   └── nodus-shell.ts
│
├── code-intel/                     # 核心引擎 — tree-sitter 语义索引 + 代码分析
│   ├── code-intelligence.ts
│   ├── code-analytics.ts
│   └── parsers/
│       ├── typescript-parser.ts
│       └── python-parser.ts
├── env-mgr/                        # 环境管理 — 项目检测
│   └── environment-manager.ts
├── git-intel/                      # Git 操作 — log/diff/blame
│   └── git-intelligence.ts
├── file-watcher/                   # 文件监听 — 增量索引
│   └── file-watcher.ts
│
├── intent/                         # 意图引擎 — NLU 解析
│   └── intent-engine.ts
└── voice/                          # 语音管线 — STT/TTS (stub)
    └── voice-pipeline.ts
```

## Architecture

```
Human Input (Voice/Text)
        │
        ▼
  Intent Engine (NLU → QueryIntent)
        │
        ▼
  Code Intelligence (query)
        │
        ├── Knowledge Store (SQLite + Memory Index)
        ├── Language Parsers (tree-sitter: TS/JS/Python)
        └── Git Intelligence (log/diff/blame)
        │
        ▼
  Query Result → Structured Output
```

## TDD Development

```bash
npm test              # 运行全部 165 个测试
npm run test:watch    # 监听模式
npm run typecheck     # TypeScript 检查
```

测试覆盖：单元测试 (~65%) + 集成测试 (~25%) + E2E/确认测试 (~10%)。

### 原生依赖兼容性

Nodus 依赖 `better-sqlite3` 与 `tree-sitter` 系列包，它们包含原生二进制（`.node`）。在某些 macOS 环境上，预编译二进制可能因签名或架构问题无法加载，表现为 `dlopen` 报错。

**快速诊断：**

```bash
npm run check:native
```

如果输出中有 ❌，请执行：

```bash
npm run rebuild:native
```

该命令会依次重新编译：

- `better-sqlite3`
- `tree-sitter`
- `tree-sitter-typescript`
- `tree-sitter-javascript`
- `tree-sitter-python`

Windows 用户请手动逐条运行：

```powershell
npm rebuild better-sqlite3
npm rebuild tree-sitter
npm rebuild tree-sitter-typescript
npm rebuild tree-sitter-javascript
npm rebuild tree-sitter-python
```

重建后再运行：

```bash
npm run check:native
npm test
```

如果仍失败，请检查：

1. Node.js 版本是否符合 `package.json` 的 `engines` 要求。
2. 是否已安装 Xcode Command Line Tools（macOS）或 Python + Visual Studio Build Tools（Windows）。
3. `node-gyp` 是否有网络问题导致无法下载头文件；可配置 `npm config set python python3` 与代理。

## 未完成事项 / TODO

> 来源：`ArchitecturalDesignPhase/05-Future-Roadmap.md`  
> 规则：按优先级逐项实现，完成一项后在此勾选，并同步更新 `npm test` 结果与相关文档。

### P0 — 尽快做

#### v1.1 基础夯实
- [x] R1.1 原生二进制兼容性治理（`better-sqlite3` / `tree-sitter` 可正常加载）
- [ ] R1.2 CodeIntelligence 单元测试与集成测试补全

#### v1.2 体验增强
- [ ] R2.1 本地轻量意图模型（BERT-tiny / ONNX，延迟 < 200ms）
- [ ] R2.2 上下文自动补全（光标/选中代码成为隐式查询参数）

#### v2.0 能力扩展
- [ ] R3.1 AI 代码生成与重构（基于索引生成 diff 卡片）

### P1 — 下个版本做

#### v1.1 基础夯实
- [ ] R1.3 跨文件引用解析增强（`tsconfig.json` paths / index re-export / namespace import）
- [ ] R1.4 类型关系建模（`inheritance` / `implements` / `type_use`）
- [ ] R1.5 TerminalRenderer 调用图 ASCII 渲染
- [ ] R1.6 配置热加载（`~/.nodus/config.json` 变更即时生效）
- [ ] R1.7 会话恢复（重启后恢复项目、文件、光标位置）
- [ ] R1.8 错误处理与降级卡片统一

#### v1.2 体验增强
- [ ] R2.3 查询历史与推荐
- [ ] R2.4 真正的语音唤醒与 STT（Porcupine / Whisper.cpp / 系统 API）
- [ ] R2.5 呼吸灯与状态指示（Idle / Listening / Working / Warning）
- [ ] R2.6 代码片段卡片（引用列表、变更历史附带代码片段与高亮）
- [ ] R2.7 模糊意图学习闭环（`feedback.jsonl` 驱动模型改进）
- [ ] R2.8 多项目快速切换（自然语言打开/切换项目）

#### v2.0 能力扩展
- [ ] R3.2 代码评审助手（基于 Git diff + 符号索引生成摘要与风险点）
- [ ] R3.3 跨域调试（日志+代码关联）
- [ ] R3.4 训练标注飞轮（AI 生成结果写入 `annotations` 表）
- [ ] R3.5 外部服务环境管理（DB / Redis / Docker 检测与启动）
- [ ] R3.8 新语言支持插件化（Rust / Go / Java 等通过插件接入）

### P2 — 远期
- [ ] R3.6 团队协作（项目级语义索引与注释共享）
- [ ] R3.7 多设备同步（查询历史、偏好、项目列表）

### 历史已完成（MVP 阶段）
- [x] 补齐数据库 Schema：`file_index_state` / `project_runtimes` / `project_dependencies` 表
- [x] 补齐数据库索引（`idx_symbols_language` / `parent` / `file_kind`、`idx_refs_kind`、`idx_file_state_checksum`、`idx_query_hist_intent`）
- [x] 在 `index_file` / `indexProject` 中使用 `file_index_state` 做 checksum 增量索引
- [x] 实现统一模块错误类型（`CodeIntelError` / `EnvError` / `GitError` / `VoiceError`）
- [x] 实现 `~/.nodus/config.json` 配置系统与热加载
- [x] 完善 EventBus 标准事件类型与 `NodusShell` 事件路由
- [x] 扩展 `UIRenderer` 接口（卡片系统、呼吸灯、输入条、代码导航）
- [x] 实现 `project_runtimes` / `project_dependencies` 的持久化与读取
- [x] 扩展 `IntentType` 支持 `list_symbols` / `stats` / `analytics`
- [x] 实现 `CodeAnalytics` 分析接口：`listSymbols`、`mostCalledFunctions`、`mostImpactfulSymbols`、`unusedExports`
- [x] 扩展 `TerminalRenderer` 支持列表/排行榜/表格/统计报告/变更热点展示
- [x] 更新意图引擎例句库覆盖新查询类型
- [x] 实现数据库迁移系统（`schema_version` + migrations）
- [x] 实现查询历史 90 天自动清理策略
- [x] 实现统一日志系统（`~/.nodus/logs/`）
- [x] 实现 `mostCoupledModules` / `longestCallChains` / `findEntryPoints` / `listTodoComments` / `complexityScores` / `mostChangedFiles`
- [x] 更新 `ArchitecturalDesignPhase/04-API-Reference.md` 新增 CodeAnalytics 章节
- [x] 新增 `ArchitecturalDesignPhase/05-Future-Roadmap.md` 并更新 HLD/API 引用

## Documentation

| 阶段 | 目录 |
|------|------|
| 需求分析 | `RequirementAnalysisPhase/` — PRD, Wireframes, Flowcharts |
| 架构设计 | `ArchitecturalDesignPhase/` — HLD, DDD, DB Schema, API Reference |
| 测试设计 | `TestDesignPhase/` — Test Plan, Test Cases, Acceptance Criteria |

## License

MIT
