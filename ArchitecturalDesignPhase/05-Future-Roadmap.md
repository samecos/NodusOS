# Nodus 后续需求路线图 (Future Roadmap)

> 版本: v1.0 | 状态: Draft | 日期: 2026-07-01
> 前置阅读: [01-HLD.md](01-HLD.md) | [02-DDD.md](02-DDD.md) | [03-Database-Schema.md](03-Database-Schema.md) | [04-API-Reference.md](04-API-Reference.md)

---

## 1. 引言

本文档在现有架构设计（01~04）和需求文档（PRD）基础上，结合当前代码实现状态，梳理 Nodus 在 MVP 之后仍可继续投入的需求与方向。它既服务于产品路线规划，也作为架构师视角下的技术债务与扩展点清单。

**当前实现状态速览**

| 模块 | 实现度 | 主要缺口 |
|------|--------|---------|
| NodusShell | 高 | 多项目同时打开、会话恢复、优雅关闭顺序 |
| ContextManager | 高 | 光标/选中上下文尚未被 IntentEngine 充分利用 |
| KnowledgeStore | 中 | `better-sqlite3` 原生二进制兼容性问题导致部分测试失败 |
| CodeIntelligence | 中 | 类型关系已建模（R1.4）；跨文件引用解析（R1.3）已完成；测试套件已补全 |
| EnvironmentManager | 中 | 运行时安装多为检测+提示，未真正自动下载安装；无外部服务（DB/Redis）发现 |
| GitIntelligence | 高 | 缺少变更摘要、PR 级 diff 分析 |
| FileWatcher | 高 | 大仓库下性能与防抖策略可优化 |
| IntentEngine | 中 | 当前为规则+相似度，无本地轻量模型；歧义学习仅记录未利用 |
| TerminalRenderer | 高 | 仅文本输出，无图形卡片与代码高亮 |
| VoicePipeline | 低 | TTS 可用，唤醒词检测与 STT 未真正跑通 |

---

## 2. 产品演进路线

### 2.1 v1.1 — 夯实基础（Foundation Hardening）

目标：让 MVP 已宣传的能力真正稳定可用，补齐测试，修复原生依赖兼容性。

| ID | 需求 | 优先级 | 说明 | 关联模块 |
|----|------|--------|------|---------|
| R1.1 | 原生二进制兼容性治理 | P0 | 解决 `better-sqlite3` / `tree-sitter` 在部分 macOS/平台因签名/架构无法加载的问题；提供 `npm rebuild` 指引或预编译脚本 | store, code-intel |
| R1.2 | CodeIntelligence 单元测试补全 | P0 | 把当前为空的 `code-intel.test.ts` / `integration.test.ts` 写满，覆盖 TS/JS/Python 解析、引用解析、调用图构建 | code-intel |
| R1.3 | 跨文件引用解析增强 | P1 | 支持 import 别名（`tsconfig.json` paths）、相对路径解析、index 文件 re-export、namespace import | code-intel |
| R1.4 | 类型关系建模 | P1 | 在 `references` 表中增加 `kind: type_use / inheritance / interface_implements`，支持 "谁实现了这个接口" 类查询 | code-intel, store |
| R1.5 | TerminalRenderer 调用图 ASCII 渲染 | P1 | 让 `call_graph` 结果在终端以树状/图状 ASCII 呈现 | ui |
| R1.6 | 配置热加载 | P1 | `~/.nodus/config.json` 变更后即时生效（theme、font_size、silent_mode 等） | common/config, file-watcher |
| R1.7 | 会话恢复 | P1 | 应用重启后自动打开上次项目、恢复上次文件与光标位置 | context, shell |
| R1.8 | 错误处理与降级卡片统一 | P1 | 所有模块错误统一走 `UIRenderer.renderError`，提供可执行建议 | common/errors, ui |

### 2.2 v1.2 — 体验增强（Experience Enhancement）

目标：在稳定基础上补齐语音、上下文感知、查询历史等让产品"顺手"的能力。

| ID | 需求 | 优先级 | 说明 | 关联模块 |
|----|------|--------|------|---------|
| R2.1 | 本地轻量意图模型 | P0 | 用 BERT-tiny / ONNX Runtime 替换纯规则+相似度，支持更多口语化表达，延迟 < 200ms | intent |
| R2.2 | 上下文自动补全 | P0 | IntentEngine 解析时主动消费 `Context.cursor_symbol` / `selected_code`，支持 "这个函数被哪里调用了" 等省略主语的查询 | intent, context |
| R2.3 | 查询历史与推荐 | P1 | 基于 `query_history` 表提供 "最近查询"、"你可能想问"、重复查询缓存 | store, intent |
| R2.4 | 真正的语音唤醒与 STT | P1 | 接入 Porcupine / Whisper.cpp 或系统 API，实现 "Nodus" 唤醒 → 录音 → 转写 → 发出 `VoiceTranscribed` 事件 | voice |
| R2.5 | 呼吸灯与状态指示 | P1 | 在终端/桌面外壳中提供 `Idle / Listening / Working / Warning` 状态可视化 | ui |
| R2.6 | 代码片段卡片 | P1 | 引用列表、变更历史等结果附带代码片段与高亮行号 | ui, code-intel |
| R2.7 | 模糊意图学习闭环 | P1 | 将 `~/.nodus/feedback.jsonl` 定期用于微调/评估意图模型 | intent |
| R2.8 | 多项目快速切换 | P1 | 支持 `打开项目 X` / `切换到项目 Y` 的自然语言项目切换 | shell, context |

### 2.3 v2.0 — 能力扩展（Capability Expansion）

目标：从"理解代码库"扩展到"主动帮助开发者完成工作"，接入 AI 生成与跨域信息。

| ID | 需求 | 优先级 | 说明 | 关联模块 |
|----|------|--------|------|---------|
| R3.1 | AI 代码生成与重构 | P0 | 在已有符号索引基础上，支持 "给这个函数加参数校验"、"重构为类" 等意图；生成 diff 卡片供用户确认 | code-intel, ui |
| R3.2 | 代码评审助手 | P0 | 基于 Git diff + 符号索引生成变更摘要、影响范围、潜在风险点 | git-intel, code-intel |
| R3.3 | 跨域调试（日志+代码关联） | P1 | 读取本地日志/终端输出，自动定位到产生日志的代码位置 | 新增模块：log-intel |
| R3.4 | 训练标注飞轮 | P1 | 用户确认/修改 AI 生成结果后，自动写入 `annotations` 表，形成训练数据 | store, ui |
| R3.5 | 外部服务环境管理 | P1 | 检测项目需要的 DB / Redis / Docker 等服务，提示或自动启动 | env-mgr |
| R3.6 | 团队协作（知识共享） | P2 | 项目级语义索引共享、注释共享；需解决隐私与权限 | store |
| R3.7 | 多设备同步 | P2 | 查询历史、偏好、打开项目列表跨设备同步；本地优先原则下可用 iCloud / 自托管 | store |
| R3.8 | 新语言支持插件化 | P1 | Rust / Go / Java 等语言通过插件机制接入，不修改 CodeIntel 核心 | code-intel |

---

## 3. 技术债务与工程缺口

以下问题当前已存在，应在 v1.1 优先偿还，否则会拖累后续功能迭代。

| 问题 | 影响 | 建议方案 |
|------|------|---------|
| `better-sqlite3` 预编译二进制加载失败 | KnowledgeStore 相关 15 个测试失败，存储功能不可用 | 提供平台特定 rebuild 脚本；CI 中增加原生依赖矩阵测试 |
| `tree-sitter` 预编译二进制加载失败 | code-intel / nodus-shell 测试套件无法运行 | 同上；考虑用纯 JS parser 作为降级方案 |
| 测试覆盖率不均 | code-intel 测试为空，voice 无测试 | 按模块补齐单元/集成测试；目标覆盖率 ≥ 70% |
| 跨文件引用解析粗糙 | 目前仅把 `external:name` 映射到同名导出符号 | 引入模块解析器，读取 `tsconfig.json` / `package.json` 的 paths/aliases |
| 类型关系缺失 | interface 实现、class 继承、type alias 使用无法查询 | 扩展 parser 提取这些边，存入 `references` 表 |
| UI 仅终端 | 无法展示真正的调用图、代码高亮 | v1.2 引入图形渲染器（Tauri/Web）或增强终端输出 |
| 意图解析无模型 | 规则维护成本高，口语化查询覆盖不足 | v1.2 引入本地轻量模型；保留规则作为兜底 |
| 反馈数据未利用 | `feedback.jsonl` 只追加不读取 | v1.2 建立定期评估/微调流程 |

---

## 4. 用户场景缺口

从 PRD 中的用户故事出发，当前实现与愿景之间的差距：

| 用户故事 | 当前实现 | 缺口 |
|----------|---------|------|
| US1: 早晨恢复 | 配置文件可记录项目路径，但无自动恢复 | 需记录最后编辑文件、光标位置、未提交变更，重启后主动呈现 |
| US2: 代码库导航 | find_symbol / find_references / call_graph 已实现 | 缺少调用图可视化、引用列表代码片段、结果风险标注 |
| US3: 环境零配置 | detect / check / install 流程已通 | 运行时真正自动安装未实现；无外部服务发现 |
| US4: 无声模式 | silent_mode 接口存在 | 缺少快捷键监听与 UI 状态切换 |
| US5: 模糊意图反问 | ambiguous 错误类型存在 | 候选生成逻辑弱，未利用上下文；学习闭环未闭合 |
| US6: 代码评审（新增） | 仅有 git log / diff / blame | 缺少基于索引的变更摘要与影响分析 |
| US7: 跨文件类型追踪（新增） | 仅有函数调用关系 | 缺少 "这个 interface 被哪些 class 实现" 等类型关系查询 |

---

## 5. 需求与现有模块对应关系

```
┌────────────────────────┬────────────────────────────────────────────┐
│ 模块                   │ 主要后续需求                                 │
├────────────────────────┼────────────────────────────────────────────┤
│ code-intel             │ R1.2, R1.3, R1.4, R2.2, R3.1, R3.2, R3.8    │
│ store                  │ R1.1, R2.3, R2.7, R3.4, R3.6, R3.7          │
│ env-mgr                │ R1.6, R3.5                                   │
│ git-intel              │ R3.2                                         │
│ intent                 │ R2.1, R2.2, R2.7                             │
│ voice                  │ R2.4                                         │
│ ui                     │ R1.5, R2.5, R2.6, R3.1, R3.4                 │
│ context                │ R1.7, R2.2, R2.8                             │
│ shell / event-bus      │ R1.7, R2.8, R1.8                             │
│ common/config          │ R1.6                                         │
└────────────────────────┴────────────────────────────────────────────┘
```

---

## 6. 优先级与依赖图

### 6.1 优先级分层

- **P0（尽快做）**: R1.1, R1.2, R2.1, R2.2, R3.1
- **P1（下个版本做）**: R1.3, R1.4, R1.5, R1.6, R1.7, R1.8, R2.3, R2.4, R2.5, R2.6, R2.7, R2.8, R3.2, R3.3, R3.4, R3.5, R3.8
- **P2（远期）**: R3.6, R3.7

### 6.2 关键依赖

```
R1.1 原生二进制兼容性
  │
  ▼
R1.2 CodeIntel 测试补全 ──► R1.3 跨文件引用 ──► R1.4 类型关系
  │
  ▼
R2.1 本地意图模型 ──► R2.2 上下文补全 ──► R2.7 反馈闭环
  │
  ▼
R2.4 真正语音 ──► R2.5 呼吸灯
  │
  ▼
R3.1 AI 代码生成 / R3.2 代码评审助手
```

**建议执行顺序**：
1. v1.1 先修原生依赖 + 补齐测试，让现有能力稳定；
2. v1.2 再升级意图引擎与语音体验；
3. v2.0 最后引入 AI 生成、代码评审等主动能力。

---

## 7. 对现有架构文档的修改建议

- `01-HLD.md` §1.3 设计目标：增加"原生依赖可移植性"作为 P1 目标。
- `01-HLD.md` §9 技术债务与风险：引用本文档 §3，避免重复罗列。
- `04-API-Reference.md` 各模块接口后增加实现状态标记（已实现 / v1.1 / v1.2 / v2.0）。
- `04-API-Reference.md` §5.11 CodeAnalytics：已有 analytics 子类型建议标注为 v1.0+，并预留 v1.2 的 `semantic_search` / v2.0 的 `generate_patch`。

---

## 8. 结论

Nodus 当前已完成"理解代码库"的核心骨架，但距离 PRD 中描绘的 AI-Native OS 体验仍有明显差距。下一步最务实的路径是：

1. **先还债**（原生依赖、测试、引用精度）；
2. **再增强体验**（意图模型、语音、上下文）；
3. **最后扩展主动能力**（AI 生成、代码评审、跨域调试）。

本文档应随实现进展每 2~4 周更新一次状态，并在版本规划会议上作为输入。
