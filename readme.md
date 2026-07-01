# Nodus (结绳)

AI-Native Operating System for Developers.  
用说话的方式理解代码库。环境这件事不让人看见。

## Quick Start

```bash
# 安装依赖
npm install

# 运行测试（71个，全绿）
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

支持中英文。支持 TypeScript、JavaScript、Python 项目。

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
├── code-intel/                     # 核心引擎 — tree-sitter 语义索引
│   ├── code-intelligence.ts
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
npm test              # 运行全部 71 个测试
npm run test:watch    # 监听模式
npm run typecheck     # TypeScript 检查
```

测试覆盖：单元测试 (109 planned) + 集成测试 (17 planned) + 确认测试 (10 planned)。

## Documentation

| 阶段 | 目录 |
|------|------|
| 需求分析 | `RequirementAnalysisPhase/` — PRD, Wireframes, Flowcharts |
| 架构设计 | `ArchitecturalDesignPhase/` — HLD, DDD, DB Schema, API Reference |
| 测试设计 | `TestDesignPhase/` — Test Plan, Test Cases, Acceptance Criteria |

## License

MIT
