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
| 类型关系 | `谁实现了 IUserService` / `UserService 继承了哪些类` |
| 代码评审 | `评审这段代码` / `检查最近变更` / `review commit abc1234` |
| 代码生成与重构 | `重构 refundOrder 为 async` / `提取验证逻辑为新函数` / `生成 payment.ts 的 diff` |
| 跨域调试 | `解析这个错误日志` / `trace this error` |
| 团队协作 | `导出项目索引` / `导入共享索引` / `给 refundOrder 添加注释` / `导出团队知识` |
| 项目切换 | `切换到 /path/to/project` / `打开另一个项目` / `列出所有项目` |
| AI 最近改了哪儿 | `AI 最近改了哪儿` / `最近有什么变更` |
| 查看带标注的代码 | `查看 payment.ts` / `打开文件 payment` |
| 语义块简报 | `块1的简报` / `这块改了什么` |
| 确认审查完成 | `这块过了` / `/confirm charge` |
| 约定管理 | `/prune add_null_check` / `/prune` |

支持中英文，支持同义改写。例如“改动 refundOrder 会影响哪些地方”“refundOrder 的影响范围”也能识别为影响分析。

支持 TypeScript、JavaScript、Python 项目。

## 新功能详述

### 查询历史与推荐（R2.3）

**查询历史：** 在 REPL 中输入 `/history` 查看最近 10 条查询记录，包含序号、执行时间、意图类型和查询原文。输入 `/history 20` 可指定条数（上限 50）。

**查询缓存：** 相同查询在 5 分钟内重复执行时，直接返回缓存结果。输出末尾会标记 `[cached]`。

**主动推荐：** 在 REPL 中输入空行（直接回车），系统会根据以下策略生成 ≤ 3 条推荐：
1. **上下文关联** — 当前光标位置的符号，推荐查看引用、影响范围
2. **高频查询** — 近期频繁执行的查询，推荐重复执行
3. **最近延续** — 从最近查询中提取符号，推荐查看调用链路

输入推荐前的序号即可直接执行对应查询。

### 呼吸灯与状态指示（R2.5）

在终端 REPL 中，查询执行时以带颜色图标的单行指示当前状态：

| 图标 | 状态 | 触发时机 |
|------|------|---------|
| `○ Nodus` | 空闲（灰） | 等待输入 / 查询完成 |
| `◑ thinking...` | 思考中（黄） | 查询解析/执行中 |
| `✖ error` | 错误（红） | 降级卡片触发 |

### 代码片段卡片（R2.6）

查询结果中的**引用列表**和**变更历史**现在会附带代码片段：

**引用列表** — 每条引用展示目标行前后 1 行的代码上下文，目标行以 `→` 标记并高亮：

```
  3 处引用

  src/payment.ts
    L42   call
    src/payment.ts
    | 41 function validateOrder(order) {
    → 42 function refundOrder(orderId) {
    | 43   return processRefund(orderId);
```

**变更历史** — 每次提交中受影响的符号（最多 5 个）附带其定义位置附近的代码片段。

代码片段自动进行终端语法高亮：关键词（蓝）、字符串（绿）、数字（黄）、注释（灰），目标行加粗。

### 意图学习闭环（R2.7）

每次成功执行的查询会自动写入 `~/.nodus/feedback.jsonl` 作为反馈数据。系统启动时会自动加载已有反馈，将用户常用的查询句式加入意图匹配引擎的例句库中，提升后续相似查询的识别率。

- **自动学习**：每次成功查询后，系统自动记录（输入文本 + 解析意图 + 置信度），追加到 `feedback.jsonl`
- **启动加载**：`bootstrap` 时自动从反馈文件加载已确认的查询句式作为新例句
- **手动触发**：输入 `/learn` 随时重新加载反馈数据，适用于多个 Nodus 会话之间传递学习成果
- **去重与限流**：相同（查询文本 + 意图类型）只保留一条，学习例句上限 100 条

### 本地轻量意图模型（R2.1）

> 状态：模块已实现，尚未接入主解析流程。

在 PatternIntentEngine 的精确匹配之外，内置了一个纯 JS 实现的轻量级神经网络意图分类器（LocalMLIntentEngine）：
- **架构**：2 层前馈网络（~6,000 参数），输入特征为词袋 + n-gram
- **训练与持久化**：支持增量训练并保存到 `~/.nodus/ml-intent-model.json`
- **当前限制**：已实现但尚未替换 `PatternIntentEngine` 作为默认解析器；当前主流程仍为精确正则 → 相似度回退两阶策略
- **模型大小**：JSON 序列化后 < 100KB，无需 TensorFlow.js / ONNX Runtime

接入后计划策略：精确正则匹配 → 神经网络回退 → 相似度回退。

### 上下文自动补全（R2.2）

当查询文本不完整或模糊时，系统自动利用当前光标位置和选中代码作为隐式参数：
- 光标在函数/方法上 → 自动补全为 `call_graph`（查看调用链路）
- 光标在类/接口上 → 自动补全为 `type_relationships`（查看继承/实现关系）
- 选中代码块 → 自动补全为 `impact_analysis`（影响分析）
- 查询含"这个"/"当前"/"it"/"this" → 自动替换为光标所在符号名
- 空查询 + 有选中代码 → 根据代码内容推断最合适的意图类型

### 语音唤醒与 STT（R2.4）

启动时自动检测麦克风可用性，可用时进入监听模式：
- **唤醒检测**：基于音频能量阈值触发监听（无需外部依赖）；高能量音频触发后进入 5 秒录音
- **录音转写**：录音结束后通过 STT 引擎转写为文本并执行查询
- **降级策略**：麦克风不可用时自动关闭监听循环，仅使用文本输入，避免持续报错
- **STT 回退**：优先使用系统语音 API（macOS dictation / Windows Speech / Linux speech-dispatcher），不可用时回退到 Whisper CLI

> 注意：当前为能量阈值唤醒，不是特定唤醒词（如"结绳"）识别。

### 多项目快速切换（R2.8）

在 REPL 中直接输入自然语言即可切换项目：
```
> 切换到 /path/to/other-project
> 打开另一个项目
> 列出所有项目
```
- 切换时自动保存当前会话状态（文件、光标位置），加载新项目时恢复上次会话
- 项目列表保存在 `~/.nodus/config.json` 的 `projectPaths` 中

### AI 代码生成与重构（R3.1）

> 状态：已接入 REPL 查询流程。

基于代码库索引生成代码变更建议：
- **重构操作**：
  - `rename`：跨文件重命名，生成 git diff（已实现）
  - `extract_function`：简单提取函数（已实现，参数/返回值处理较简单）
  - `extract_variable` / `move`：已预留接口，当前为占位实现
- **Diff 生成**：基于自然语言描述（如"将 refundOrder 改为 async"）生成 git diff 兼容的变更
- **改进建议**：基于代码分析（死代码、复杂度、模块耦合）生成可操作建议
- 输出格式遵循 git unified diff 规范

**REPL 触发示例：**
```
> 重构 refundOrder 为 async
> 提取验证逻辑为新函数
> 生成 payment.service.ts 的 diff
> 给出代码改进建议
```

### 代码评审助手（R3.2）

> 状态：已接入 REPL 查询流程。

基于 Git diff + 符号索引生成评审意见：
- **评审提交**：`评审 commit abc1234` / `review commit abc1234`
- **分析维度**：变更范围（大规模变更警告）、风险等级（高风险文件检测）、代码风格（console.log/空 catch）、潜在 bug（== 松散相等、any 类型、未处理 Promise）
- **输出格式**：按 `info` / `warning` / `critical` 分级的 ReviewComment，包含文件、行号、严重程度、分类

> 当前支持通过 commit hash 触发；未提供 commit hash 时会提示用户补充。

### 跨域调试（R3.3）

> 状态：已接入 REPL 查询流程。

关联日志输出与代码位置，支持跨文件/跨层的错误追踪：
- **日志解析**：支持 Node.js/V8 stack traces、Python traceback、结构化 JSON 日志、常见框架日志格式（Express/NestJS/Django）
- **错误追踪**：从日志错误自动追踪到代码位置，关联最近的符号定义和调用方
- **代码关联**：`correlateLogWithCode` 将日志条目与代码索引关联，返回相关符号、调用方、相关度评分

**REPL 触发示例：**
```
> 解析这个错误日志 TypeError: Cannot read property 'x' of undefined at func (src/app.ts:42:10)
> trace this error
```

### 训练标注飞轮（R3.4）

每次成功执行的查询会自动写入 SQLite `annotations` 表：
- **自动记录**：保存查询原文、意图类型、完整输出 JSON
- **数据用途**：为后续意图模型微调与结果质量评估提供标注样本
- **查询接口**：`KnowledgeStore.annotationRecord` / `annotationRecent` 可读取近期标注

> 当前为静默自动记录，尚未提供显式的人工标注/修正界面。

### 外部服务环境管理（R3.5）

打开项目时自动检测外部服务：
- **检测范围**：PostgreSQL、MySQL、Redis、Docker、MongoDB
- **检测方式**：扫描 `.env`、`docker-compose.yml`、`redis.conf`、`package.json` 依赖；检查端口监听和进程状态
- **启动建议**：未运行服务自动提供启动命令（`docker compose up`、`redis-server`、`pg_ctl start` 等）

### 团队协作（R3.6）

> 状态：已接入 REPL 查询流程；团队注释仍写入独立 JSON 文件，与 SQLite annotations 表尚未打通。

支持项目级语义索引与注释共享：
- **导出索引**：`shareIndex(projectPath)` 导出项目符号、引用为 JSON 共享格式
- **导入索引**：`importSharedIndex(json)` 将共享索引导入本地知识库
- **符号注释**：`addAnnotation` 在符号上添加团队注释（当前写入独立 JSON 文件）
- **导出团队知识**：`exportTeamKnowledge()` 合并项目索引与团队注释为知识包

**REPL 触发示例：**
```
> 导出项目索引
> 导入共享索引 { "version": "1.0", ... }
> 给 refundOrder 添加注释 "需要校验 order 状态"
> 导出团队知识
```

### 人与 AI 代码产出对齐：理解层（R4.1）

> 状态：P1 已实现并接入 REPL。P2（编辑器叠加层）待开发。

破局「车在前面跑、人在后面追」——AI agent 写代码速度太快，人跟不上、颗粒度对不上、读不完。Nodus 作为旁观者，在代码上铺一层「理解热力图 + 语义路标」，让人扫一眼就知道哪段危险、该在哪停。

**设计定位：** 旁观者——只读 Git/文件，不侵入任何 AI 工具（Cursor/Copilot/Claude Code/手写一视同仁），不拦截 AI 行为。

**四大模块：**

- **ChangeSensor（变更传感器）**：监听 Git 工作树变更（`git diff --name-only HEAD` + `git ls-files --others`），打包成 ChangeBatch，提取被改动的符号。
- **DebtEngine（理解债引擎）**：按符号计算"理解债" `debt = changeRecency × uncoveredRatio × difficulty`，把"模糊的焦虑感"变成可量化、可排序的热力图（绿/<1 · 黄/1-3 · 红/>3）。两态语义：examined（隐式，看过简报减半）→ confirmed（显式，确认后清零）。
- **SemanticChunker（语义切片器）**：按模块目录将变更符号聚类为 1–8 个一组的语义块，每块生成简报卡（影响半径 · 风险等级 · 复杂度热点 · 测试覆盖 · 建议抽检点）。对齐颗粒度——AI 按任务产出大块代码，人按语义块理解。
- **AlignmentFlywheel（对齐飞轮）**：捕获人对 AI 代码的修正 → `classifyDiff` 自动分类 tag（add_null_check / add_error_handling / add_type 等 8 类）→ 累积到 `conventions` 表 → 生成 `.nodus/conventions.md` 反喂 AI 工具，让 AI 越用越准。

**REPL 可用命令：**

| 输入 | 效果 |
|------|------|
| `AI 最近改了哪儿` | 检测工作树变更 → 债值热力图 + 语义块列表 |
| `查看 payment.ts` | 带行级债值标注的代码视图 |
| `块1的简报` | 语义块简报卡（影响半径/风险/建议抽检） |
| `这块过了` / `/confirm charge` | 债值清零 |
| `/prune` | 列出当前约定 |
| `/prune add_null_check` | 删除过时约定 |

**数据层新增：** `debt_entries`（理解债）、`code_annotations`（代码修正标注）、`conventions`（约定模式）三张表，迁移版本 v4-v6。

> P1 已知简化（v2 排期）：热力图需多批次累积或接入 ImpactAnalysis 后才有梯度（P1 的 `blastRadius` 硬编码 0.5，新鲜变更 debt < 1.0）；聚类用目录代替调用图连通分量；飞轮自动捕获依赖 FileWatcher + 保存静默窗口（尚未接入）。完整设计见 `docs/superpowers/specs/2026-07-05-human-ai-alignment-pacing-design.md`。

### 多设备同步（R3.7）

> 状态：模块已实现，尚未接入 REPL 主流程。

同步查询历史、偏好、项目列表跨设备：
- **导出数据包**：`exportSyncData()` 生成包含查询历史、偏好、项目列表、会话状态、反馈数据的 JSON 包
- **增量同步**：支持 `since` 时间戳过滤，仅同步新数据
- **智能合并**：`importSyncData` 支持 merge 模式（去重合并）和 overwrite 模式（全量覆盖）
- **版本控制**：数据包格式版本号（当前 v1），未来可平滑升级

> 当前可通过 REPL `/sync` 命令或 `DeviceSync` 模块以编程方式调用。

### 语言插件化（R3.8）

> 状态：插件框架已实现，扩展语言解析器待补充。

代码解析器重构为插件系统，新增语言无需修改核心代码：
- **PluginRegistry**：统一管理语言插件，`register`/`unregister`/`getParserForFile`
- **现有插件**：TypeScript、JavaScript、Python 已注册为插件
- **扩展语言**：插件框架支持 `rust` / `go` / `java` / `csharp` / `cpp` 等，只需实现 `LanguagePlugin` 接口并注册；当前尚未提供这些语言的实际解析器与 grammar 依赖
- **别名支持**：`registerAlias('javascript', 'typescript')` 自动复用已有解析器

> 如需支持新语言，需额外安装对应 tree-sitter grammar 并实现 `LanguagePlugin`。

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
| `/list` | 列出所有可调用的查询能力 |
| `/history` | 查看最近 10 条查询历史 |
| `/history <n>` | 查看最近 n 条查询历史（上限 50） |
| `/learn` | 从 `~/.nodus/feedback.jsonl` 重新加载学习句式 |
| `/feedback <文本>` | 提交使用反馈，保存到 `~/.nodus/feedback.jsonl` |
| `/switch <项目路径>` | 切换到指定项目 |
| `/list-projects` | 列出所有已配置的项目 |
| `/sync` | 手动触发多设备同步 |
| `/confirm <符号名>` | 确认符号审查完成，债值清零 |
| `/prune [tag]` | 列出约定 / 删除指定约定 |
| *(自然语言)* | `重构 refundOrder 为 async` / `解析这个错误日志` / `导出项目索引` |
| *(空行)* | 显示推荐查询，输入序号即可执行 |

### 配置文件

Nodus 在 `~/.nodus/config.json` 中维护配置，启动时自动加载。示例：

```json
{
  "projectPaths": ["/path/to/your/project"],
  "dbPath": "~/.nodus/nodus.db",
  "locale": "zh-CN",
  "voice": {
    "wakeWord": "结绳",
    "silentMode": false
  },
  "ui": {
    "theme": "system"
  },
  "env": {
    "autoInstallRuntime": true,
    "autoInstallDeps": true
  },
  "codeIntel": {
    "excludePatterns": ["node_modules", ".git", "dist", "build"]
  }
}
```

修改配置后，下次启动生效（部分配置支持热加载）。

### 日志与数据目录

| 路径 | 用途 |
|------|------|
| `~/.nodus/nodus.db` | SQLite 知识库 |
| `~/.nodus/config.json` | 用户配置 |
| `~/.nodus/logs/` | 运行日志 |
| `~/.nodus/feedback.jsonl` | 用户反馈记录 |
| `.nodus/conventions.md` | 项目约定（由对齐飞轮自动生成，反喂 AI 工具） |

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
├── common/                         # 共享基础设施
│   ├── types.ts                    # 核心类型定义
│   ├── config.ts                   # JSON 配置 + 热加载
│   ├── errors.ts                   # 统一错误类型与降级建议
│   └── logger.ts                   # 文件日志系统
│
├── store/                          # 数据层 — SQLite 持久化 + 迁移
│   ├── knowledge-store.ts
│   └── migrations.ts
├── context/                        # 上下文追踪 — 文件、光标、历史
│   └── context-manager.ts
├── shell/                          # 外壳 — 事件总线 + 模块编排
│   ├── event-bus.ts
│   ├── query-cache.ts
│   ├── recommendation-engine.ts
│   └── nodus-shell.ts
│
├── code-intel/                     # 核心引擎 — tree-sitter 语义索引 + 代码分析
│   ├── code-intelligence.ts
│   ├── code-intelligence.impl.ts
│   ├── code-analytics.ts
│   ├── code-analytics.impl.ts
│   ├── reference-resolver.ts       # 跨文件引用解析
│   ├── module-resolver.ts          # tsconfig paths / index re-export
│   └── parsers/
│       ├── plugin-system.ts        # 语言解析器插件系统
│       ├── typescript-parser.ts
│       └── python-parser.ts
├── code-gen/                       # AI 代码生成与重构
│   ├── code-generator.ts
│   └── code-generator.impl.ts
├── code-review/                    # 代码评审助手
│   ├── code-reviewer.ts
│   └── code-reviewer.impl.ts
├── debug/                          # 跨域调试（日志+代码关联）
│   ├── cross-domain-debugger.ts
│   └── cross-domain-debugger.impl.ts
├── collab/                         # 团队协作（索引共享 + 注释）
│   ├── team-collaboration.ts
│   └── team-collaboration.impl.ts
├── sync/                           # 多设备同步
│   ├── device-sync.ts
│   └── device-sync.impl.ts
├── env-mgr/                        # 环境管理 — 项目/运行时/依赖/外部服务检测
│   ├── environment-manager.ts
│   └── environment-manager.impl.ts
├── git-intel/                      # Git 操作 — log/diff/blame
│   ├── git-intelligence.ts
│   └── git-intelligence.impl.ts
├── file-watcher/                   # 文件监听 — 增量索引
│   ├── file-watcher.ts
│   └── file-watcher.impl.ts
│
├── change-sensor/                  # 变更传感器 — 旁观监听 Git 变更
│   ├── change-sensor.ts
│   └── change-sensor.impl.ts
├── understanding-debt/             # 理解债引擎 — 债值计算/持久化/两态切换
│   ├── debt-formula.ts             # 债值公式纯函数
│   ├── debt-engine.ts
│   └── debt-engine.impl.ts
├── semantic-chunk/                 # 语义切片 — 按模块聚类 + 简报卡
│   ├── semantic-chunker.ts
│   ├── brief-template.ts
│   └── semantic-chunker.impl.ts
├── alignment/                      # 对齐飞轮 — 修正捕获 + 约定反哺
│   ├── tag-classifier.ts           # diff → tag 启发式规则库
│   ├── conventions-emitter.ts      # PluggableEmitter 接口
│   ├── alignment-flywheel.ts
│   ├── alignment-flywheel.impl.ts
│   └── emitters/
│       └── nodus-md-emitter.ts     # .nodus/conventions.md 发射器
├── overlay/                        # 叠加层 — 带标注代码视图（P1 终端 / P2 编辑器）
│   └── annotated-view.ts
│
├── intent/                         # 意图引擎 — NLU 解析（正则 + 神经网络 + 学习闭环）
│   ├── intent-engine.ts
│   ├── intent-engine.impl.ts
│   └── local-ml-intent-engine.ts
├── ui/                             # 结果格式化与 UI 抽象
│   ├── ui-renderer.ts
│   └── terminal-renderer.ts
└── voice/                          # 语音管线 — 唤醒词 + 录音 + STT + TTS
    ├── voice-pipeline.ts
    ├── voice-pipeline.impl.ts
    ├── audio-recorder.ts
    ├── stt-engine.ts
    └── wake-word-detector.ts
```

## Architecture

```
Human Input (Voice/Text)
        │
        ▼
  Intent Engine (NLU → QueryIntent)
  ├─ PatternIntentEngine (正则精确匹配)
  ├─ LocalMLIntentEngine (轻量神经网络回退)
  └─ Context Auto-Complete (上下文补全)
        │
        ▼
  Code Intelligence (query)
        │
        ├── Knowledge Store (SQLite + Memory Index)
        ├── Language Parsers (tree-sitter 插件系统)
        │   ├── TypeScript / JavaScript
        │   ├── Python
        │   └── Rust / Go / Java / C++ (插件化)
        ├── Git Intelligence (log/diff/blame)
        ├── Code Analytics (统计/热点/耦合/死代码)
        ├── Code Generation (diff/refactor)
        ├── Code Review (风险/风格/bug 检测)
        ├── Cross-Domain Debugger (日志+代码关联)
        ├── Team Collaboration (索引共享/注释)
        ├── Device Sync (多设备数据同步)
        ├── Change Sensor (Git 变更感知)
        ├── Debt Engine (理解债热力图)
        ├── Semantic Chunker (语义切片+简报)
        ├── Alignment Flywheel (修正捕获+约定反哺)
        └── Annotated View (带标注代码视图)
        │
        ▼
  Query Result → Structured Output
```

## TDD Development

```bash
npm test              # 运行全部 472 个测试
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
- [x] R1.2 CodeIntelligence 单元测试与集成测试补全

#### v1.2 体验增强
- [x] R2.1 本地轻量意图模型（BERT-tiny / ONNX，延迟 < 200ms）
- [x] R2.2 上下文自动补全（光标/选中代码成为隐式查询参数）

#### v2.0 能力扩展
- [x] R3.1 AI 代码生成与重构（基于索引生成 diff 卡片）

### P1 — 下个版本做

#### v1.1 基础夯实
- [x] R1.3 跨文件引用解析增强（`tsconfig.json` paths / index re-export / namespace import）
- [x] R1.4 类型关系建模（`inheritance` / `implements` / `type_use`）
- [x] R1.5 TerminalRenderer 调用图 ASCII 渲染
- [x] R1.6 配置热加载（`~/.nodus/config.json` 变更即时生效）
- [x] R1.7 会话恢复（重启后恢复项目、文件、光标位置）
- [x] R1.8 错误处理与降级卡片统一

#### v1.2 体验增强
- [x] R2.3 查询历史与推荐
- [x] R2.4 语音唤醒与 STT（能量阈值唤醒 / 系统 API 回退）
- [x] R2.5 呼吸灯与状态指示（Idle / Listening / Working / Warning）
- [x] R2.6 代码片段卡片（引用列表、变更历史附带代码片段与高亮）
- [x] R2.7 模糊意图学习闭环（`feedback.jsonl` 驱动模型改进）
- [x] R2.8 多项目快速切换（自然语言打开/切换项目）

#### v2.0 能力扩展
- [x] R3.1 AI 代码生成与重构（基于索引生成 diff 卡片，已接入 REPL）
- [x] R3.2 代码评审助手（基于 Git diff + 符号索引生成摘要与风险点）
- [x] R3.3 跨域调试（日志+代码关联，已接入 REPL）
- [x] R3.4 训练标注飞轮（AI 生成结果写入 `annotations` 表）
- [x] R3.5 外部服务环境管理（DB / Redis / Docker 检测与启动）
- [x] R3.6 团队协作（项目级语义索引与注释共享，已接入 REPL）
- [x] R3.7 多设备同步（查询历史、偏好、项目列表，REPL `/sync` 已接入）
- [x] R3.8 新语言支持插件化（Rust / Go / Java 等通过插件接入）

### P1.5 — 理解层（人与 AI 代码产出对齐）
- [x] R4.1 理解层 P1（ChangeSensor + DebtEngine + SemanticChunker + AlignmentFlywheel + AnnotatedView + REPL 接入）

#### P2 — 理解层增强（待实现）
- [ ] R4.2 编辑器叠加层（LSP server + VSCode 扩展，理解信息就地长在代码上）
- [ ] R4.3 飞轮自动捕获（FileWatcher + 保存静默窗口 → ChangeSensor.start → 自动 capture，无需手动触发）
- [ ] R4.4 债值校准（接入 ImpactAnalysis 替换硬编码 blastRadius；ChangeSensor 存真实 git diff hunk 替换声明行扫描，让热力图有梯度）
- [ ] R4.5 调用图连通分量聚类（SemanticChunker 从目录聚类升级为调用图诱导子图连通分量）
- [ ] R4.6 DebtEngine 权重自校准（攒够 50 条 `(debt_at_review, did_modify)` 配对后重拟合公式权重）
- [ ] R4.7 每日衰减 cron（`debtDecayAll` 定时执行，防僵尸红区）
- [ ] R4.8 CursorRules / AgentsMd 发射器（PluggableEmitter 扩展，检测到对应 AI 工具时自动发射约定文件）
- [ ] R4.9 跨批次语义块合并（连续多批变更的语义块关联追踪）
- [ ] R4.10 LLM 提炼通用 conventions（从带溯源的具体模式升级为抽象规则）
- [ ] R4.11 团队 conventions 共享（`.nodus/conventions.md` 纳入团队协作模块）
- [ ] R4.12 杂项清理（`/list` 补全理解层能力、CYAN/BLUE 去重、`debtAll` 死代码清理、新 QueryResult 变种加入卡片白名单）

### 历史已完成（MVP 阶段）
- [x] 补齐数据库 Schema：`file_index_state` / `project_runtimes` / `project_dependencies` 表
- [x] 补齐数据库索引（`idx_symbols_language` / `parent` / `file_kind`、`idx_refs_kind`、`idx_file_state_checksum`、`idx_query_hist_intent`）
- [x] 在 `index_file` / `indexProject` 中使用 `file_index_state` 做 checksum 增量索引
- [x] 实现统一模块错误类型（`CodeIntelError` / `EnvError` / `GitError` / `VoiceError`）
- [x] 实现 `~/.nodus/config.json` 配置系统与热加载
- [x] 完善 EventBus 标准事件类型与 `NodusShell` 事件路由
- [x] 扩展 `UIRenderer` 接口（卡片系统、呼吸灯、输入条、代码导航）
- [x] 实现 `project_runtimes` / `project_dependencies` 的持久化与读取
- [x] 扩展 `IntentType` 支持 `find_definition` / `find_references` / `call_graph` / `impact_analysis` / `change_history` / `symbol_overview` / `list_symbols` / `stats` / `analytics` / `type_relationships`
- [x] 实现 `CodeAnalytics` 分析接口：`listSymbols`、`mostCalledFunctions`、`mostImpactfulSymbols`、`unusedExports`、`mostCoupledModules`、`longestCallChains`、`findEntryPoints`、`listTodoComments`、`complexityScores`、`mostChangedFiles`、`typeRelationships`
- [x] 实现跨文件引用解析器（`ReferenceResolver` + `ModuleResolver`）
- [x] 扩展 `TerminalRenderer` 支持列表/排行榜/表格/统计报告/变更热点/类型关系/错误降级卡片展示
- [x] 更新意图引擎例句库覆盖新查询类型
- [x] 实现数据库迁移系统（`schema_version` + migrations）
- [x] 实现查询历史 90 天自动清理策略
- [x] 实现统一日志系统（`~/.nodus/logs/`）
- [x] 实现原生依赖检测脚本（`npm run check:native` / `npm run rebuild:native`）
- [x] 实现打包脚本（`npm run build` / `npm run package` / `npm run run:pkg`）
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
