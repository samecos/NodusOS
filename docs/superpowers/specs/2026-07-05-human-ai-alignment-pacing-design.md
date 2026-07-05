# 人与 AI 代码产出的对齐：理解层设计

> 破局「车在前面跑、人在后面追」——AI agent 写代码速度太快，无法对齐颗粒度，代码阅读不完。

- 状态：设计已澄清并分段确认，待 spec 审阅
- 日期：2026-07-05
- 关联模块（新增）：`src/understanding-debt/`、`src/semantic-chunk/`、`src/alignment/`、`src/change-sensor/`、`src/overlay/`
- 关联模块（复用，零改动）：CodeReviewer、ImpactAnalysis、CodeAnalytics、CodeGenerator（diff 单元）、GitIntelligence、FileWatcher、RecommendationEngine、TerminalRenderer
- 关联数据层增量：`store/migrations.ts` 增 `debt_entries` 表、扩展 `annotations` 表、增 `conventions` 表

---

## 1. 背景与问题

### 1.1 痛点

用户使用 AI Agent 写代码时：

1. **生产速度太快**：AI 一次性产出大量代码，人跟不上。
2. **没法对齐颗粒度**：AI 按"任务"产出大块代码，人按"行/符号"理解。颗粒度错位。
3. **代码阅读不完**：审查积压，形成「车在前面跑、人在后面追」的窘境。

### 1.2 三痛点 → 两种破局杠杆

| 痛点 | 对应杠杆 |
|------|---------|
| 读不完 | **理解加速器**：用强力理解工具放大人的审查吞吐量 |
| 颗粒度对不上 | **对齐飞轮**：捕获修正反哺，让 AI 越用越准、需审的越少；并对齐颗粒度 |
| 速度太快 | 由叠加层底座（活体影响图谱）打底，理解信息永远在场 |

本设计同时落地两条杠杆：**理解加速器**作短期主攻，**对齐飞轮**作长期闭环。

### 1.3 一句话定位

> NodusOS 不拦车也不追车，而是在路面上铺一层「理解热力图 + 语义路标」——车跑得再快，人扫一眼就知道哪段危险、该在哪停。

---

## 2. 设计约束（来自 brainstorming 澄清）

| 维度 | 选择 | 含义 |
|------|------|------|
| 核心杠杆 | 理解加速器 + 对齐飞轮 | 短期放大吞吐量，长期靠飞轮收敛审查量 |
| 接入位置 | **旁观者**：监听 Git/文件变更 | 不侵入任何 AI 工具；任何工具（Cursor/Copilot/Claude Code/手写）的产物一视同仁 |
| 交互范式 | **叠加层式** | 理解信息长在代码上，隐式触发，不另开队列/界面 |
| 飞轮喂养 | 两者都要 | 既喂 Nodus 自身评审模型，又提炼 conventions 文件反喂 AI 工具 |

### 2.1 与既有定位的契合

- 项目原则「OS 层信息整合器，不替代编辑器」→ 旁观者定位完全自洽。
- 项目原则「认知卸载，务实降级」→ 理解层全异步、失败静默降级。
- 项目原则「人授权限 > 主动计算」→ 理解层只读 Git/文件，不拦截 AI 工具、不改源码。
- 渐进式确认模式（`docs/04-interaction-paradigm.md`）→ 理解层是其"低风险自动 / 高风险待审"分级理念在审查侧的延伸。

---

## 3. 整体架构

### 3.1 新增「理解层」

在现有分层之上插入一个横切理解层，复用能力层产物、不重造轮子：

```
┌─────────────────────────────────────────────────────┐
│  人机接口层                                           │
│   ├ REPL / Terminal AnnotatedView (P1)               │
│   └ Overlay via LSP / 编辑器扩展 (P2, 北极星)          │
├─────────────────────────────────────────────────────┤
│  ★ 理解层（新增）                                      │
│   ├ ChangeSensor        — 感知 AI 变更批次             │
│   ├ DebtEngine          — 理解债 计算/持久化/自校准      │
│   ├ SemanticChunker     — 语义切片 + 简报生成          │
│   └ AlignmentFlywheel   — 修正捕获 + 双向反哺          │
├─────────────────────────────────────────────────────┤
│  能力层（复用，零改动）                                  │
│   CodeReviewer · ImpactAnalysis · CodeAnalytics       │
│   CodeGenerator · GitIntelligence · FileWatcher       │
│   RecommendationEngine                                │
├─────────────────────────────────────────────────────┤
│  数据层                                               │
│   KnowledgeStore + 新增 debt_entries /                 │
│   annotations(已有设计,扩展) / conventions 表           │
└─────────────────────────────────────────────────────┘
```

### 3.2 端到端数据流（全貌）

```
AI 工具改文件
   │ (fs.watch + git diff)
   ▼
ChangeSensor ──→ ChangeBatch(变更批次)
   │
   ├──→ DebtEngine: 重算受影响符号的债值 ──→ 叠加层热力图(A)
   │
   └──→ SemanticChunker: 聚类语义块 ──→ 每块生成简报 ──→ 叠加层路标(B)
                                              │
                                              ▼
                          人打开文件 / 查询简报(C 活体图谱打底)
                                              │
                          人审完 → 标记已审 / 修正代码
                                              │
                                              ▼
                          AlignmentFlywheel:
                            · diff(snapshot vs after) → annotations 表
                            · 命中简报维度统计 → 调简报模板
                            · 反复出现的修正模式 → conventions.md
                            · 同模式历史修正 → DebtEngine 风险加权
```

### 3.3 设计原则

1. **旁观者原则**：理解层只读 Git 与文件，不写源码、不拦截 AI 工具、不改其行为。失败时静默降级，绝不让用户的编辑器/REPL 卡住。
2. **复用优先**：债值三输入源（变更速度 / 复杂度 / 影响半径）全部来自已实现的 `mostChangedFiles` / `complexityScores` / `ImpactAnalysis.riskLevel`，不重造。
3. **叠加层是北极星**：理解信息"长在代码上"是终极形态。NodusOS 当前是终端 CLI，分两阶段交付——P1 先做终端近似版；P2 通过 LSP/编辑器扩展实现就地叠加。数据层与契约在两阶段间零迁移。
4. **飞轮闭环**：每个模块都产生可回放的信号——债值变化、简报命中、人类修正——全部入存储，既喂 DebtEngine 自校准，又生成 conventions 反喂 AI 工具。

---

## 4. DebtEngine：理解债引擎

直接打"读不完"痛点——把"模糊的焦虑感"变成可量化、可排序的热力图。

### 4.1 债值公式

债按**每个符号**计算，聚合到文件用于显示。

```
debt(symbol) = changeRecency × uncoveredRatio × difficulty

changeRecency  = Σ_i  e^(-Δt_i / τ)        // τ = 7 天衰减；近期变更权重大
uncoveredRatio = 1 - reviewedCoverage       // 0 = 已审完, 1 = 完全没看
difficulty     = ½ · norm(complexity) + ½ · norm(blastRadius)
                 // complexity 来自 CodeAnalytics.complexityScores
                 // blastRadius 来自 ImpactAnalysis.affectedFiles 数
```

- `changeRecency` 大致 0–5；`uncoveredRatio` 与 `difficulty` 都在 0–1。整体 debt ≈ 0–5。
- 显示阈值：`<1` 绿 / `1–3` 黄 / `>3` 红。
- 文件级热力图色 = 该文件内所有符号 debt 的最大值——一眼看到最红那坨。
- `norm()` 为**全库分位归一化**：把当前符号的 complexity / blastRadius 放到全库符号集合里取分位（0–1）。这避免不同尺度相加爆炸，也使 difficulty 可跨项目比较。归一化分位本身是 DebtEngine 可调权重之一（见 4.5）。
- `Δt_i` 为符号第 i 次变更距今的时间间隔；τ 是衰减时间常数（默认 7 天，可调）。

### 4.2 reviewedCoverage 的两态语义

为兼顾"隐式触发"与可显式确认，定义两态：

| 态 | 触发 | uncoveredRatio 效果 |
|----|------|---------------------|
| examined | 叠加层为该符号呈现过简报/影响视图（隐式） | 减半（1 → 0.5）|
| confirmed | 人在叠加层显式点了"已审/通过" | 清零（→ 0）|

隐式扫描不算审完，但表明"已知存在"；显式确认才清债。叠加层不背"待办队列"包袱，又留了精确清零的口子。

### 4.3 状态存储：`debt_entries` 表

新增表（`store/migrations.ts` 追加迁移）：

```sql
CREATE TABLE debt_entries (
    symbol_id      TEXT NOT NULL,
    file_path      TEXT NOT NULL,
    debt           REAL NOT NULL,
    change_recency REAL NOT NULL,
    difficulty     REAL NOT NULL,
    examined_at    INTEGER,        -- 首次呈现简报/影响的时间；NULL 表未看过
    confirmed_at   INTEGER,        -- 显式确认时间；NULL 表未确认
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (symbol_id)
);
CREATE INDEX idx_debt_file ON debt_entries(file_path);
CREATE INDEX idx_debt_value ON debt_entries(debt DESC);
```

### 4.4 触发时机

1. **ChangeSensor 发出 change-batch** → 重算受影响符号 + 其影响半径内邻居的 debt。
2. **叠加层呈现简报/影响视图** → `examined_at = now`。
3. **人显式确认**（`/confirm <symbol>` 或自然语言"这块过了"）→ `confirmed_at = now`，`uncoveredRatio` 归零。
4. **每日衰减 cron** → 全表 `changeRecency` 衰减老化，防僵尸红区。

### 4.5 飞轮自校准（简版）

DebtEngine 暴露**可调权重**：τ、difficulty 的复杂度/半径配比、归一化分位。AlignmentFlywheel 持续记 `(debt_at_review, did_modify)` 配对；每攒够 N=50 条重拟合权重——目标：让"事后真被改"的符号在事前 debt 排名更高。校准过程透明、可回滚、权重写入配置可见。不引入在线学习框架，纯统计。

---

## 5. SemanticChunker：语义切片简报

直接打"颗粒度对不上"——把 AI 大块产出重新切成人能一口吞的语义块，每块自带理解证明。

### 5.1 为什么按语义切，不按文件/commit

AI 一次改 8 个文件可能是 3 件事；一次 commit 也可能捎带 3 件事。文件和 commit 都是人造边界，不是认知边界。NodusOS 按**调用图连通性**聚类——同一件事的改动必然在同一片调用子图里。

### 5.2 聚类算法（结构驱动，确定可复现）

输入：一个 ChangeBatch 的所有受影响符号（由 tree-sitter 解析 `git diff` 后得到）。

```
1. 取所有被改动符号集合 S
2. 在全局调用图上导出 S 的诱导子图 G[S]
3. 连通分量 = 候选语义块
4. 子聚类（当一个分量过大或横跨明显不同的目录/命名模式时）：
   - 按文件所属模块（一级目录）切
   - 按符号名 token 重叠切（如都带 retry / refactor / fix 前缀归一组）
5. 产出 chunks: [{symbols, files, change_hunks}[n]]
```

约束：最小块 1 符号、最大块 ~8 符号；超过则强制子聚类。同一 diff 必得同一组块（幂等、可复现），不依赖 LLM 推断意图。

### 5.3 简报模板（每块一张卡）

字段全部从已有能力派生，无新算法：

| 字段 | 来源 |
|------|------|
| 块标题 | 最频繁出现符号名 + 模块目录 |
| 改动符号 | 块内符号列表 + 各自 complexity |
| 影响半径 | 跨块聚合 `ImpactAnalysis.affectedFiles` |
| 风险等级 | 复用 `CodeReviewer.overallRisk` 聚合 |
| 复杂度热点 | 块内 complexity 最高的 1–2 个符号 |
| 测试影响 | 查 test 文件是否引用块内符号；无则标"无测试覆盖" |
| 已知隐患 | `CodeReviewer` 针对这些文件的现有 comments |
| 建议抽检点 | 一处具体 `file:line`，选 difficulty 最高且最近改动的 |

人扫一张卡，30 秒决定"过 / 深挖 / 抽检"。

### 5.4 渲染与稳定性

- **P1 终端近似**：简报以结构化卡片呈现（沿用 `terminal-renderer.ts` 卡片范式），可通过"这块改了什么 / 查看简报"等自然语言触发；AnnotatedView 在代码视图旁附简报摘要。
- **P2 叠加层**：同一张卡浮在编辑器内对应代码段旁；同块变更高亮关联。
- **稳定性**：每个 ChangeBatch 独立切片，幂等。跨批次连续合并为 v2 候选。

---

## 6. AlignmentFlywheel：对齐飞轮

长期闭环——从"对每个变更审计"逐步走向"少数模式无需审计"。

### 6.1 捕获什么信号

每个人工审完后捕获三类三元组：

```
1. 修正信号    (snapshot, after, symbols_involved)
              → diff(snapshot, after) 即"人对 AI 代码做了什么修正"
2. 命中信号    (brief_fields_shown, action)  action ∈ {pass, dig, reject}
              → 哪些简报字段帮人做了决定
3. 债值快照    (debt_at_review, did_modify)
              → 事后是否被改，反推事前债值预测准不准
```

**`snapshot` / `after` 的快照语义**（消除歧义）：

- `snapshot` = ChangeSensor 在感知到一个 ChangeBatch 完成（保存活动静默超过窗口阈值，默认 30s）时，对该批次涉及文件的工作树快照。代表"AI 刚交付、人尚未介入"的状态。
- `after` = 该批次进入人审后，人编辑保存产生的下一组工作树状态。
- `diff(snapshot, after)` 即人的修正。若人未改任何文件，diff 为空，仅记 `(debt_at_review, did_modify=false)`。
- 若同一符号先后被多个批次触及，每个批次独立记一条 annotations 行；conventions 按 tag 累积，不去重。

### 6.2 存储：扩展已设计的 `annotations` 表 + 新增 `conventions` 表

利用 `docs/07-detailed-design.md` 已设计的 annotations schema 并扩展：

```sql
CREATE TABLE annotations (
    ai_generated_code   TEXT NOT NULL,
    human_modified_code TEXT NOT NULL,
    diff                TEXT NOT NULL,
    symbols_involved    TEXT,            -- JSON
    annotation_tags     TEXT,            -- JSON: ["add_null_check","add_validation"]
    chunk_id            TEXT,            -- 所属语义块
    brief_field_hits    TEXT,            -- JSON: 命中的简报字段
    action              TEXT,            -- pass | dig | reject
    debt_at_review      REAL,            -- 审查时的债值快照
    created_at          INTEGER NOT NULL
);
CREATE INDEX idx_anno_tags ON annotations(annotation_tags);
CREATE INDEX idx_anno_symbol ON annotations(symbols_involved);

CREATE TABLE conventions (
    tag            TEXT PRIMARY KEY,     -- "add_null_check"
    pattern_desc   TEXT NOT NULL,        -- "调用外部服务后未判空"
    occurrences    INTEGER NOT NULL DEFAULT 0,
    symbol_examples TEXT,                -- JSON: 典型示例符号
    last_seen      INTEGER NOT NULL
);
```

### 6.3 修正 tag 自动分类（规则库，可扩展）

不引入 LLM 抽象。基于 diff 的启发式规则匹配：

| diff 模式 | tag |
|-----------|-----|
| null/undefined 判断新增 | `add_null_check` |
| try/catch / py except 新增 | `add_error_handling` |
| 参数类型标注新增 | `add_type` |
| 变量/函数重命名 | `rename_symbol` |
| 函数体抽离 | `extract_function` |
| 删除 console.log/debugger | `remove_debug` |
| 删冗余分支 | `simplify` |
| 回滚整段 | `revert` |

新增 `src/alignment/tag-classifier.ts`，规则可热加载。命中率不够时人工补规则。

### 6.4 双向反哺

**1) 喂 DebtEngine**：

- `(debt_at_review, did_modify)` 攒够阈值 → 重拟合债务权重，可回滚。
- `conventions` 表里的高频 tag → DebtEngine 收到新变更时，若 diff 命中该 tag 模式（如检测到"调外部服务但无判空"），主动加权提升 debt。**在事前就把"大概率要被改"的地方标红**。

**2) 生成 conventions 文件反喂 AI 工具**：

不同 AI 工具读不同文件。PluggableEmitter 模式：

```
ConventionsEmitter (接口)
├── NodusMdEmitter     → .nodus/conventions.md       (默认)
├── CursorRulesEmitter → .cursorrules                (检测到项目用 Cursor 时)
├── AgentsMdEmitter    → AGENTS.md 追加段             (检测到 Claude Code 时)
└── (可扩展)
```

MVP 阶段不抽象成通用规则，直接列**带溯源的具体模式**（AI 工具读得懂）：

```markdown
# 项目约定（由 NodusOS 从人工修正中提炼）

## 已知需人工修正的模式
- **add_null_check**: "调用 PaymentService 外部方法后未判空" 出现 5 次
  示例符号: PaymentService.charge, PaymentService.refund
- **add_type**: "refactorOrder 函数参数未标注类型" 出现 3 次
  ...
```

人工可 `/prune` 删过时项。版本可追溯，AI 工具收到的是具体且可溯源的反馈。

### 6.5 隐私与边界

- 修正信号全部本地存储，不上传。
- `conventions.md` 是项目内文件，团队成员都能受益（团队协作模块的天然延伸）。
- 不重写用户的 AI 工具配置，只写约定的文件路径；用户可 `.gitignore` 或手动管理。

---

## 7. 叠加层渲染与交互

### 7.1 P1：终端近似版 AnnotatedView

Nodus 已有 `terminal-renderer.ts` 卡片范式。新增 `AnnotatedView`——把文件代码视图升级为带行级标注的版本：

```
16  async function charge(amount) {
       └─[AI 改过] 债值 4.1 ●红 │ 块2: PaymentService 加重试 │ 影响半径 5 │ 复杂度高
17    const result = await pay(amount);
       └─[AI 改过] 债值 3.2 ●黄 │ 建议从此处开始审查
18    return result;
```

- 通过"查看 payment.ts" / "AI 最近改了哪儿"等自然语言触发。
- 简报卡：同一命令流里继续说"块2的简报"，渲染 SemanticChunker 卡片。
- 显式确认：`/confirm charge` 或自然语言"这块过了" → `confirmed_at = now`，debt 清零。
- 隐式 examined：呈现过简报/影响视图自动标记。

### 7.2 P2：编辑器叠加层（北极星）

NodusOS 后端不变，**契约相同**，只换交付层：

```
src/overlay/                          # 新增
├── overlay-server.ts                 # 对外契约：debt / chunk / brief 三类查询
├── lsp/
│   └── nodus-lsp.ts                  # LSP server 暴露 hover / diagnostic / codeLens
└── vscode/
    └── nodus-overlay/                # VSCode 扩展（后续可加 Cursor / JetBrains）
```

- 真就地处叠加：悬停 → 影响半径卡片；代码段旁出现色块热区；侧栏出现简报卡。
- 同一份 DebtEngine / SemanticChunker / AlignmentFlywheel 数据，P1→P2 数据迁移为零。
- 失败时静默降级，绝不卡编辑器——所有查询异步，结果就绪才注入。

### 7.3 交互契约（两阶段一致）

| 动作 | 触发方式 | 效果 |
|------|---------|------|
| 隐式呈现 | 打开/查看被改文件 | 叠加层自动出现（异步降级） |
| 深挖 | 点/问"这处影响谁" | 调用图 / 影响半径展开（examined 标记） |
| 显式确认 | `/confirm X` / "这块过了" | debt 清零 |
| 修正捕获 | 编辑器保存 | `diff(snapshot, after)` 入飞轮 |

---

## 8. 端到端流、降级、测试与分阶段

### 8.1 端到端示例旅程

```
人用 Cursor 改了 8 个文件，关掉 Cursor
   │
   ▼ FileWatcher + git diff 感知
ChangeSensor 打包成 ChangeBatch（含 12 个受影响符号）
   │
   ├─→ DebtEngine 重算 debt：3 个符号变红（complexity 高 + blastRadius 大 + 未审）
   │
   └─→ SemanticChunker 聚类：12 符号 → 3 块 ─→ 3 张简报卡生成
   │
   ▼
人打开 Nodus，"AI 最近改了哪儿"
   → AnnotatedView 渲染：3 处红区高亮，旁挂简报摘要
   │
   ▼ "块2简报"
简报卡：块2 = "PaymentService 加重试" · 影响半径 5 · 风险中 · 复杂度热点 charge() · 测试无覆盖 · 建议抽检 payment.ts:16
   │
   ▼ 人审完块2，确认 OK → "/confirm 块2" → 该块 debt 清零
   ▼ 人发现块3 缺 null 检查 → 在编辑器补上 → 保存
AlignmentFlywheel: diff 捕获 → tag=add_null_check → 写 annotations
   → conventions.add_null_check 出现次数 +1
   → DebtEngine 收到下个变更若命中"外部调用无判空" → 主动加权红区
   → ConventionsEmitter 重写 .nodus/conventions.md → Cursor 下次读取后少犯
   │
   ▼ 50 条 (debt, did_modify) 攒齐 → DebtEngine 重拟合权重 → 越审越准
```

### 8.2 降级矩阵

| 故障 | 降级 |
|------|------|
| tree-sitter 解析失败 | 回退文件级债值（无符号粒度），简报按文件切 |
| git 不可用 | 仅靠 FileWatcher 时间窗口感知变更，无 blame 上下文 |
| DebtEngine 超时 | 给陈旧债值 + 警告标记 |
| SemanticChunker 聚类失败 | 退化为按文件分组 |
| 叠加层渲染失败 | 降为纯代码视图，可查询性保留 |
| conventions 发射失败 | 仅更新本地表，不写文件，下次重试 |

**铁律**：理解层任何模块挂掉，不能让编辑器/REPL 卡住——全部异步，结果就绪才注入。

### 8.3 测试策略（沿用项目约定）

- **DebtEngine**：构造符号集 + 调用图，断言债值公式 + 衰减 + 两态切换。`TC-UT-DE-001+`
- **SemanticChunker**：固定 diff 夹具，断言聚类唯一性 + 简报字段非空。`TC-UT-SC-001+`
- **AlignmentFlywheel**：mock staged/after，断言 tag 分类 + conventions 累积 + emitter 输出。`TC-UT-AF-001+`
- **ChangeSensor**：在临时 git 仓库造变更，断言批次打包。`TC-UT-CS-001+`
- **集成测试**：端到端跑一遍 8.1 的旅程，断言债值归零 + annotations 入库 + conventions 文件生成。

### 8.4 分阶段交付

- **P1（终端近似 + 落地闭环）**：ChangeSensor + DebtEngine + SemanticChunker + AlignmentFlywheel（核心）+ AnnotatedView + 终端简报卡。全在现有 CLI 内闭环，能跑通 8.1 旅程。
- **P2（编辑器叠加层）**：`overlay-server` + LSP + VSCode 扩展。数据层零迁移，只换交付层。
- **v2 候选**：跨批次语义块合并、LLM 提炼通用 conventions、团队 conventions 共享、债值预测的在线学习。

---

## 9. 模块清单与文件落点

### 9.1 新增模块

```
src/
├── change-sensor/
│   ├── change-sensor.ts            # 接口
│   ├── change-sensor.impl.ts       # 默认实现：监听 FileWatcher + git diff
│   └── change-sensor.test.ts
├── understanding-debt/
│   ├── debt-engine.ts              # 接口
│   ├── debt-engine.impl.ts         # 公式 + 触发 + 自校准
│   ├── debt-engine.test.ts
│   └── debt-formula.ts             # 公式纯函数（便于测试）
├── semantic-chunk/
│   ├── semantic-chunker.ts         # 接口
│   ├── semantic-chunker.impl.ts    # 聚类 + 简报合成
│   ├── brief-template.ts           # 简报字段装配
│   └── semantic-chunker.test.ts
├── alignment/
│   ├── alignment-flywheel.ts       # 接口
│   ├── alignment-flywheel.impl.ts  # 三类信号捕获 + 反哺调度
│   ├── tag-classifier.ts           # diff → tag 规则库
│   ├── conventions-emitter.ts      # PluggableEmitter 接口
│   ├── emitters/
│   │   ├── nodus-md-emitter.ts
│   │   ├── cursor-rules-emitter.ts
│   │   └── agents-md-emitter.ts
│   └── alignment-flywheel.test.ts
├── overlay/
│   ├── overlay-server.ts           # 对外契约（P2）
│   ├── annotated-view.ts           # P1 终端带标注视图
│   ├── annotated-view.test.ts
│   ├── lsp/                        # P2
│   └── vscode/                     # P2
```

### 9.2 复用模块（零改动）

- `src/code-review/code-reviewer.impl.ts` → 风险等级 + comments
- `src/code-intel/code-intelligence.impl.ts` → `ImpactAnalysis`
- `src/code-intel/code-analytics.impl.ts` → `complexityScores` / `mostChangedFiles`
- `src/code-gen/code-generator.impl.ts` → `CodeChange[]` diff 单元格式参考
- `src/git-intel/git-intelligence.impl.ts` → diff / log / blame
- `src/file-watcher/file-watcher.impl.ts` → 文件变更事件源
- `src/shell/recommendation-engine.ts` → "接下来审哪块"的候选
- `src/ui/terminal-renderer.ts` → 卡片渲染范式

### 9.3 数据层增量（`store/migrations.ts`）

追加三条迁移：`debt_entries` 表、`annotations` 表（含扩展字段）、`conventions` 表。对应在 `migrations.test.ts` 补迁移测试。

### 9.4 intent 接入（`intent/intent-engine.impl.ts`）

新增意图类型（沿用现有 pattern 匹配机制）：

| 意图 | 触发示例 |
|------|---------|
| `recent_changes` | "AI 最近改了哪儿" / "最近有什么变更" |
| `view_annotated` | "查看 payment.ts" / "打开文件 payment" |
| `chunk_brief` | "块2的简报" / "这块改了什么" |
| `confirm_reviewed` | "这块过了" / "/confirm charge" |
| `prune_conventions` | "删掉 add_null_check 约定" / "/prune" |

---

## 10. 非目标

明确不做：

1. **不限制 AI 工具产出速度**——Nodus 是旁观者，不是闸门。
2. **不替代编辑器**——叠加层信息长在代码上，编辑仍在用户现有工具里。
3. **不引入在线学习框架**——飞轮自校准用纯统计 + 可回滚权重，不上 ML 训练栈。
4. **不做跨批次语义块合并**（v2 候选）——P1 每批次独立切片。
5. **不做 LLM 抽象通用 conventions**（v2 候选）——P1 只列带溯源的具体模式。
6. **不做团队 conventions 共享**（v2 候选）——P1 单机本地。
7. **不拦截 AI 工具行为**——conventions 文件是建议性的，AI 工具读取与否不在 Nodus 控制范围。

---

## 11. 成功标准

- **P1 闭环可跑通**：6/8.1 旅程在现有 CLI 端到端跑通，断言债值归零 + annotations 入库 + conventions 文件生成。
- **审查提速**：作者自用一周，主观感受审查吞吐量较裸读代码明显提升（沿用项目"生存测试"原则）。
- **颗粒度对齐**：每批 AI 变更产出语义块 1–5 个，每块简报 30 秒内可读完并决定动作。
- **飞轮转动**：连续使用 50 次审查后，DebtEngine 权重至少完成一次重拟合且可回滚；`conventions.md` 至少累积 3 条模式。
- **降级可靠**：理解层任一模块模拟故障时，REPL/编辑器不卡顿，可查询性保留。

---

## 附录 A：与既有设计文档的对照

| 既有概念 | 本设计的延伸 |
|---------|-------------|
| 渐进式确认（`04-interaction-paradigm.md`） | "低风险自动 / 高风险待审"理念延伸到审查侧：DebtEngine 的风险分级决定叠加层提示强度 |
| 指令→执行→交付→确认 节奏 | 理解层补全"交付"环节的"理解证明"——交付物不止是 diff，还有简报+热力图 |
| annotations 表（`07-detailed-design.md`） | 该表设计落地并扩展，由 AlignmentFlywheel 写入 |
| 双通道模型（指挥官+审查官） | 审查官角色的工具化——叠加层是审查官的"眼镜" |
| 训练标注飞轮 R3.4（`05-Future-Roadmap.md`） | 从"已设计未实现"推进到 P1 落地 |
