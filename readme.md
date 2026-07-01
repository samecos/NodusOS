# Nodus (结绳)

AI-Native Operating System for Developers.  
用说话的方式理解代码库。环境这件事不让人看见。

## Quick Start

```bash
# 安装依赖
npm install

# 运行测试（当前：160 个测试，全绿）
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
npm test              # 运行全部 160 个测试
npm run test:watch    # 监听模式
npm run typecheck     # TypeScript 检查
```

测试覆盖：单元测试 (~65%) + 集成测试 (~25%) + E2E/确认测试 (~10%)。

### 原生依赖兼容性

项目依赖 `better-sqlite3` 与 `tree-sitter` 两个带原生二进制（`.node`）的 npm 包。在某些 macOS 环境上，预编译二进制可能因签名或架构问题无法加载，表现为 `dlopen` 报错。

若遇到此类问题，尝试从源码重新编译：

```bash
# 修复 node-gyp-build 无执行权限（如 npm rebuild 报 126）
chmod +x node_modules/.bin/node-gyp-build

# 重新编译
npm rebuild better-sqlite3
npm rebuild tree-sitter
npm rebuild tree-sitter-typescript
npm rebuild tree-sitter-javascript
npm rebuild tree-sitter-python
```

## 未完成事项 / TODO

> 完成一项后在此勾选，并同步更新 `npm test` 结果。

### P0 — 阻塞性问题
- [x] 补齐数据库 Schema：`file_index_state` / `project_runtimes` / `project_dependencies` 表
- [x] 补齐数据库索引（`idx_symbols_language` / `parent` / `file_kind`、`idx_refs_kind`、`idx_file_state_checksum`、`idx_query_hist_intent`）
- [x] 在 `index_file` / `indexProject` 中使用 `file_index_state` 做 checksum 增量索引

### P1 — MVP 功能缺口
- [x] 实现统一模块错误类型（`CodeIntelError` / `EnvError` / `GitError` / `VoiceError`）
- [x] 实现 `~/.nodus/config.json` 配置系统与热加载
- [x] 完善 EventBus 标准事件类型与 `NodusShell` 事件路由
- [x] 扩展 `UIRenderer` 接口（卡片系统、呼吸灯、输入条、代码导航）
- [x] 实现 `project_runtimes` / `project_dependencies` 的持久化与读取
- [x] 扩展 `IntentType` 支持 `list_symbols` / `stats` / `analytics`
- [x] 实现 `CodeAnalytics` 分析接口：`listSymbols`、`mostCalledFunctions`、`mostImpactfulSymbols`、`unusedExports`
- [x] 扩展 `TerminalRenderer` 支持列表/排行榜/表格/统计报告/变更热点展示
- [x] 更新意图引擎例句库覆盖新查询类型

### P2 — 工程化与文档
- [x] 实现数据库迁移系统（`schema_version` + migrations）
- [x] 实现查询历史 90 天自动清理策略
- [x] 实现统一日志系统（`~/.nodus/logs/`）
- [x] 实现 `mostCoupledModules` / `longestCallChains` / `findEntryPoints` / `listTodoComments` / `complexityScores` / `mostChangedFiles`
- [x] 更新 `ArchitecturalDesignPhase/04-API-Reference.md` 新增 CodeAnalytics 章节
- [x] 更新 README 功能说明与测试数量

## Documentation

| 阶段 | 目录 |
|------|------|
| 需求分析 | `RequirementAnalysisPhase/` — PRD, Wireframes, Flowcharts |
| 架构设计 | `ArchitecturalDesignPhase/` — HLD, DDD, DB Schema, API Reference |
| 测试设计 | `TestDesignPhase/` — Test Plan, Test Cases, Acceptance Criteria |

## License

MIT
