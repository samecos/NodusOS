# Nodus (结绳)

AI-Native Operating System for Developers.  
用说话的方式理解代码库。环境这件事不让人看见。

## Quick Start

```bash
# 安装依赖
npm install

# 运行测试（当前：98 个测试，全绿）
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
npm test              # 运行全部 85 个测试
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
- [x] 修复 `better-sqlite3` 原生二进制加载问题（15 个 store 测试失败）
- [x] 修复 `tree-sitter` / `tree-sitter-typescript` 原生二进制加载问题（3 个测试套件无法运行）
- [x] 补全 `code-intelligence.test.ts` 单元测试
- [x] 补全 `code-intelligence.integration.test.ts` 集成测试
- [x] 补全 `nodus-shell.test.ts` 测试

### P1 — MVP 功能缺口
- [x] 实现真正的 VoicePipeline（唤醒词 + 录音 + STT）
- [x] 实现 EnvironmentManager 真正的运行时自动安装（Node/Python）
- [x] 提升代码解析精度：跨文件引用、类型引用、继承关系、装饰器
- [x] 完善 `changeHistory` 符号级变更追踪
- [x] 修复 `impactAnalysis` 中 `transitiveCallers` 为空的问题
- [x] 修复 `TypeScriptParser.isExported` 逻辑 bug
- [x] 修复 `PythonParser.parseReferences` 硬编码文件路径 `'src/test.py'`
- [x] 将 `IntentEngine` 中的 CommonJS `require` 改为 ESM 动态导入
- [x] 修复 `NodusShell` 中 `result_count` 计算、`installRuntime` 版本参数为空等细节

### P2 — 工程化与文档
- [x] 为 VoicePipeline 添加单元测试
- [x] 更新 `readme.md` 测试状态描述并补充原生依赖处理文档

## Documentation

| 阶段 | 目录 |
|------|------|
| 需求分析 | `RequirementAnalysisPhase/` — PRD, Wireframes, Flowcharts |
| 架构设计 | `ArchitecturalDesignPhase/` — HLD, DDD, DB Schema, API Reference |
| 测试设计 | `TestDesignPhase/` — Test Plan, Test Cases, Acceptance Criteria |

## License

MIT
