# 人与 AI 代码产出对齐（理解层）P1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 NodusOS 现有 CLI 内闭环实现理解层（ChangeSensor + DebtEngine + SemanticChunker + AlignmentFlywheel + AnnotatedView），让人用自然语言审查 AI 生成的代码变更，并捕获修正反哺。

**Architecture:** 新增理解层横切复用已有能力层（CodeReviewer / ImpactAnalysis / CodeAnalytics / GitIntelligence / FileWatcher），数据走共享 KnowledgeStore（加 3 张表）。旁观者定位：只读 Git/文件，不侵入 AI 工具。P2 叠加层（LSP/VSCode）不在本计划内。

**Tech Stack:** TypeScript ESM + NodeNext, better-sqlite3, Vitest, 现有 tree-sitter 解析器

## Global Constraints

- Node.js >= 20.0.0, ESM (`"type": "module"`), `verbatimModuleSyntax: true` → 类型导入写 `import type`
- 严格模式 `strict: true`，不允许隐式 `any`，优先 `unknown` 收窄
- 文件 kebab-case，接口 PascalCase 不加 `I` 前缀，实现类用 `Impl` 后缀
- 测试用 Vitest，`globals: true`，测试用例编号 `TC-UT-<MODULE>-NNN`
- 注释/JSDoc 用中文，标识符用英文
- `execSync` / 外部命令改动需谨慎；原生依赖报错先 `npm run check:native`
- 现有 `annotations` 表是意图反馈标注（input_text/intent_type），**不要碰**。代码修 正信号用新表 `code_annotations`
- 所有新 QueryResult 变种必须在 `TerminalRenderer.render` 的 switch 里加上分支

---

## 文件结构总览

**新建文件：**

```
src/
├── change-sensor/
│   ├── change-sensor.ts              # ChangeSensor 接口 + ChangeBatch 类型
│   ├── change-sensor.impl.ts         # 默认实现
│   └── change-sensor.test.ts
├── understanding-debt/
│   ├── debt-engine.ts                # DebtEngine 接口 + DebtEntry 类型
│   ├── debt-formula.ts               # 债值公式纯函数
│   ├── debt-engine.impl.ts           # 实现：公式 + store + analytics + codeIntel
│   └── debt-engine.test.ts
├── semantic-chunk/
│   ├── semantic-chunker.ts           # SemanticChunker 接口 + SemanticChunk/BriefCard 类型
│   ├── brief-template.ts             # 简报字段装配
│   ├── semantic-chunker.impl.ts      # 聚类 + 简报合成
│   └── semantic-chunker.test.ts
├── alignment/
│   ├── tag-classifier.ts             # diff → tag 规则库
│   ├── tag-classifier.test.ts
│   ├── conventions-emitter.ts        # ConventionsEmitter 接口 + 类型
│   ├── emitters/
│   │   └── nodus-md-emitter.ts       # .nodus/conventions.md 发射器
│   ├── alignment-flywheel.ts         # AlignmentFlywheel 接口
│   ├── alignment-flywheel.impl.ts    # 三类信号捕获 + 反哺调度
│   └── alignment-flywheel.test.ts
├── overlay/
│   ├── annotated-view.ts             # P1 终端带标注视图
│   └── annotated-view.test.ts
```

**修改文件：**

```
src/common/types.ts                   # +5 IntentType 值 + 新类型
src/store/migrations.ts               # +3 条迁移 (version 4/5/6)
src/store/migrations.test.ts          # 更新 expectedTables
src/store/knowledge-store.ts          # +debt/codeAnnotation/convention CRUD 接口
src/store/knowledge-store.impl.ts     # +对应实现
src/store/knowledge-store.test.ts     # +对应测试
src/code-intel/code-intelligence.ts   # +QueryResult 新变种
src/intent/intent-engine.impl.ts      # +5 条 intent pattern
src/ui/terminal-renderer.ts           # +render 分支
src/shell/nodus-shell.ts              # 接线 + 意图路由 + 事件路由
src/main.ts                           # +/confirm + /prune 命令
```

---

### Task 1: 共享类型定义

**Files:**
- Modify: `src/common/types.ts:192-206` (IntentType 联合) + 文件末尾追加新类型

**Interfaces:**
- Produces: `IntentType` 新增 5 个值；`ChangeBatch`, `ChangedSymbol`, `DebtEntry`, `CodeAnnotationRecord`, `Convention`, `SemanticChunk`, `BriefCard`, `ReviewAction` 类型供后续所有 task 使用

- [ ] **Step 1: 追加 IntentType 新值**

在 `src/common/types.ts` 的 IntentType 联合（约第 193 行）末尾 `'list_projects'` 之后追加：

```typescript
export type IntentType =
  | 'find_definition'
  | 'find_references'
  | 'call_graph'
  | 'impact_analysis'
  | 'change_history'
  | 'symbol_overview'
  | 'list_symbols'
  | 'stats'
  | 'analytics'
  | 'type_relationships'
  | 'code_review'
  | 'switch_project'
  | 'list_projects'
  | 'recent_changes'
  | 'view_annotated'
  | 'chunk_brief'
  | 'confirm_reviewed'
  | 'prune_conventions';
```

- [ ] **Step 2: 在文件末尾追加理解层类型**

在 `src/common/types.ts` 末尾（`CodeChange` 接口之后）追加：

```typescript
// ============================================================
// 理解层类型 — 人与 AI 代码产出对齐
// ============================================================

/** 审查动作 */
export type ReviewAction = 'pass' | 'dig' | 'reject';

/** 变更批次中一个被改动的符号快照 */
export interface ChangedSymbol {
  symbol_id: SymbolId;
  name: string;
  file_path: string;
  line_start: number;
  line_end: number;
  /** 该符号在这批变更中的 diff 文本 */
  diff_text: string;
}

/** 变更批次 — ChangeSensor 产出的原子单位 */
export interface ChangeBatch {
  /** 唯一标识（时间戳 + 文件数哈希） */
  id: string;
  /** 项目根路径 */
  project_root: string;
  /** 批次检测时间（ISO 8601） */
  detected_at: string;
  /** 受影响文件列表 */
  files: string[];
  /** 受影响符号列表 */
  symbols: ChangedSymbol[];
  /** 工作树快照（文件路径 → 内容），代表"AI 刚交付"状态 */
  snapshot: Record<string, string>;
}

/** 理解债条目 */
export interface DebtEntry {
  symbol_id: string;
  file_path: string;
  debt: number;
  change_recency: number;
  difficulty: number;
  examined_at: number | null;
  confirmed_at: number | null;
  updated_at: number;
}

/** 代码修正标注记录（区别于意图反馈的 AnnotationEntry） */
export interface CodeAnnotationRecord {
  id?: number;
  ai_generated_code: string;
  human_modified_code: string;
  diff: string;
  symbols_involved: string;
  annotation_tags: string;
  chunk_id: string | null;
  brief_field_hits: string | null;
  action: ReviewAction;
  debt_at_review: number | null;
  created_at: string;
}

/** 约定模式 */
export interface Convention {
  tag: string;
  pattern_desc: string;
  occurrences: number;
  symbol_examples: string | null;
  last_seen: number;
}

/** 语义块 */
export interface SemanticChunk {
  id: string;
  symbols: ChangedSymbol[];
  files: string[];
  title: string;
}

/** 简报卡 */
export interface BriefCard {
  chunk_id: string;
  title: string;
  symbols: { name: string; complexity: number }[];
  impact_radius: number;
  risk_level: RiskLevel;
  complexity_hotspots: string[];
  test_coverage: boolean;
  known_issues: string[];
  suggested_inspect_point: { file: string; line: number } | null;
}
```

- [ ] **Step 3: 运行类型检查验证**

Run: `npx tsc --noEmit`
Expected: 无新增类型错误

- [ ] **Step 4: 提交**

```bash
git add src/common/types.ts
git commit -m "feat(types): 理解层共享类型定义 + 5 个新 IntentType"
```

---

### Task 2: 数据库迁移

**Files:**
- Modify: `src/store/migrations.ts:150-188` (MIGRATIONS 数组)
- Modify: `src/store/migrations.test.ts:55` (expectedTables)

**Interfaces:**
- Produces: version 4/5/6 三条迁移，创建 `debt_entries` / `code_annotations` / `conventions` 表

- [ ] **Step 1: 在 migrations.ts 的 MIGRATIONS 数组末尾追加三条迁移**

在 `src/store/migrations.ts` 的 `MIGRATIONS` 数组中，version 3 之后追加：

```typescript
  {
    version: 4,
    name: 'add_debt_entries',
    up: `
      CREATE TABLE IF NOT EXISTS debt_entries (
        symbol_id      TEXT PRIMARY KEY,
        file_path      TEXT NOT NULL,
        debt           REAL NOT NULL,
        change_recency REAL NOT NULL,
        difficulty     REAL NOT NULL,
        examined_at    INTEGER,
        confirmed_at   INTEGER,
        updated_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_debt_file ON debt_entries(file_path);
      CREATE INDEX IF NOT EXISTS idx_debt_value ON debt_entries(debt DESC);
    `,
  },
  {
    version: 5,
    name: 'add_code_annotations',
    up: `
      CREATE TABLE IF NOT EXISTS code_annotations (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        ai_generated_code   TEXT NOT NULL,
        human_modified_code TEXT NOT NULL,
        diff                TEXT NOT NULL,
        symbols_involved    TEXT,
        annotation_tags     TEXT,
        chunk_id            TEXT,
        brief_field_hits    TEXT,
        action              TEXT NOT NULL,
        debt_at_review      REAL,
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_code_anno_tags ON code_annotations(annotation_tags);
      CREATE INDEX IF NOT EXISTS idx_code_anno_symbol ON code_annotations(symbols_involved);
    `,
  },
  {
    version: 6,
    name: 'add_conventions',
    up: `
      CREATE TABLE IF NOT EXISTS conventions (
        tag             TEXT PRIMARY KEY,
        pattern_desc    TEXT NOT NULL,
        occurrences     INTEGER NOT NULL DEFAULT 0,
        symbol_examples TEXT,
        last_seen       INTEGER NOT NULL
      );
    `,
  },
```

- [ ] **Step 2: 更新 migrations.test.ts 的 expectedTables**

在 `src/store/migrations.test.ts` 第 55 行，`expectedTables` 数组追加三张表：

```typescript
    const expectedTables = ['symbols', 'refs', 'projects', 'file_index_state', 'query_history', 'session_state', 'annotations', 'debt_entries', 'code_annotations', 'conventions'];
```

- [ ] **Step 3: 运行迁移测试**

Run: `npx vitest run src/store/migrations.test.ts`
Expected: 4 个测试全部 PASS

- [ ] **Step 4: 提交**

```bash
git add src/store/migrations.ts src/store/migrations.test.ts
git commit -m "feat(store): 迁移 v4-v6 debt_entries/code_annotations/conventions 表"
```

---

### Task 3: KnowledgeStore 接口与实现扩展

**Files:**
- Modify: `src/store/knowledge-store.ts:84-88` (接口方法)
- Modify: `src/store/knowledge-store.impl.ts:580` (实现)
- Modify: `src/store/knowledge-store.test.ts` (测试)
- Test: `src/store/knowledge-store.test.ts`

**Interfaces:**
- Consumes: `DebtEntry`, `CodeAnnotationRecord`, `Convention` from `common/types.ts`
- Produces: KnowledgeStore 新增方法供 DebtEngine / AlignmentFlywheel 调用

- [ ] **Step 1: 在 knowledge-store.ts 接口追加方法签名**

在 `src/store/knowledge-store.ts` 的 `annotationDelete` 方法之后、`close()` 之前追加：

```typescript
  // ---- 理解债 ----
  debtUpsert(entry: DebtEntry): void;
  debtGet(symbolId: string): DebtEntry | undefined;
  debtGetByFile(filePath: string): DebtEntry[];
  debtGetTop(limit: number): DebtEntry[];
  debtUpdateExamined(symbolId: string, examinedAt: number): void;
  debtUpdateConfirmed(symbolId: string, confirmedAt: number): void;
  debtDecayAll(decayFactor: number): number;
  debtAll(): DebtEntry[];

  // ---- 代码修正标注 ----
  codeAnnotationRecord(entry: Omit<CodeAnnotationRecord, 'id'>): number;
  codeAnnotationList(limit?: number): CodeAnnotationRecord[];

  // ---- 约定 ----
  conventionUpsert(tag: string, patternDesc: string, symbolExample: string | null): void;
  conventionGet(tag: string): Convention | undefined;
  conventionList(): Convention[];
  conventionDelete(tag: string): boolean;
  conventionIncrement(tag: string, symbolExample: string | null): void;
```

同时在文件顶部 import 中加入新类型：

```typescript
  DebtEntry, CodeAnnotationRecord, Convention,
```

- [ ] **Step 2: 在 knowledge-store.impl.ts 追加实现**

在 `src/store/knowledge-store.impl.ts` 的 `rowToAnnotation` 方法之后、`close()` 之前追加：

```typescript
  // ========== 理解债 ==========

  debtUpsert(entry: DebtEntry): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO debt_entries
        (symbol_id, file_path, debt, change_recency, difficulty, examined_at, confirmed_at, updated_at)
      VALUES (@symbol_id, @file_path, @debt, @change_recency, @difficulty, @examined_at, @confirmed_at, @updated_at)
    `).run({
      symbol_id: entry.symbol_id,
      file_path: entry.file_path,
      debt: entry.debt,
      change_recency: entry.change_recency,
      difficulty: entry.difficulty,
      examined_at: entry.examined_at,
      confirmed_at: entry.confirmed_at,
      updated_at: entry.updated_at,
    });
  }

  debtGet(symbolId: string): DebtEntry | undefined {
    const row = this.db.prepare('SELECT * FROM debt_entries WHERE symbol_id = ?').get(symbolId) as Record<string, unknown> | undefined;
    return row ? this.rowToDebtEntry(row) : undefined;
  }

  debtGetByFile(filePath: string): DebtEntry[] {
    const rows = this.db.prepare('SELECT * FROM debt_entries WHERE file_path = ? ORDER BY debt DESC').all(filePath) as Record<string, unknown>[];
    return rows.map(r => this.rowToDebtEntry(r));
  }

  debtGetTop(limit: number): DebtEntry[] {
    const rows = this.db.prepare('SELECT * FROM debt_entries ORDER BY debt DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map(r => this.rowToDebtEntry(r));
  }

  debtUpdateExamined(symbolId: string, examinedAt: number): void {
    this.db.prepare('UPDATE debt_entries SET examined_at = ?, updated_at = ? WHERE symbol_id = ?')
      .run(examinedAt, Date.now(), symbolId);
  }

  debtUpdateConfirmed(symbolId: string, confirmedAt: number): void {
    this.db.prepare('UPDATE debt_entries SET confirmed_at = ?, debt = 0, updated_at = ? WHERE symbol_id = ?')
      .run(confirmedAt, Date.now(), symbolId);
  }

  debtDecayAll(decayFactor: number): number {
    const result = this.db.prepare('UPDATE debt_entries SET change_recency = change_recency * ?, updated_at = ?')
      .run(decayFactor, Date.now());
    return result.changes;
  }

  debtAll(): DebtEntry[] {
    const rows = this.db.prepare('SELECT * FROM debt_entries').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToDebtEntry(r));
  }

  private rowToDebtEntry(row: Record<string, unknown>): DebtEntry {
    return {
      symbol_id: row.symbol_id as string,
      file_path: row.file_path as string,
      debt: row.debt as number,
      change_recency: row.change_recency as number,
      difficulty: row.difficulty as number,
      examined_at: row.examined_at as number | null,
      confirmed_at: row.confirmed_at as number | null,
      updated_at: row.updated_at as number,
    };
  }

  // ========== 代码修正标注 ==========

  codeAnnotationRecord(entry: Omit<CodeAnnotationRecord, 'id'>): number {
    const result = this.db.prepare(`
      INSERT INTO code_annotations
        (ai_generated_code, human_modified_code, diff, symbols_involved, annotation_tags,
         chunk_id, brief_field_hits, action, debt_at_review, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.ai_generated_code,
      entry.human_modified_code,
      entry.diff,
      entry.symbols_involved,
      entry.annotation_tags,
      entry.chunk_id,
      entry.brief_field_hits,
      entry.action,
      entry.debt_at_review,
      entry.created_at,
    );
    return Number(result.lastInsertRowid);
  }

  codeAnnotationList(limit: number = 50): CodeAnnotationRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM code_annotations ORDER BY created_at DESC, id DESC LIMIT ?'
    ).all(limit) as Record<string, unknown>[];
    return rows.map(r => this.rowToCodeAnnotation(r));
  }

  private rowToCodeAnnotation(row: Record<string, unknown>): CodeAnnotationRecord {
    return {
      id: row.id as number,
      ai_generated_code: row.ai_generated_code as string,
      human_modified_code: row.human_modified_code as string,
      diff: row.diff as string,
      symbols_involved: row.symbols_involved as string,
      annotation_tags: row.annotation_tags as string,
      chunk_id: row.chunk_id as string | null,
      brief_field_hits: row.brief_field_hits as string | null,
      action: row.action as ReviewAction,
      debt_at_review: row.debt_at_review as number | null,
      created_at: row.created_at as string,
    };
  }

  // ========== 约定 ==========

  conventionUpsert(tag: string, patternDesc: string, symbolExample: string | null): void {
    this.db.prepare(`
      INSERT INTO conventions (tag, pattern_desc, occurrences, symbol_examples, last_seen)
      VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(tag) DO UPDATE SET pattern_desc = excluded.pattern_desc, symbol_examples = excluded.symbol_examples
    `).run(tag, patternDesc, symbolExample, Date.now());
  }

  conventionGet(tag: string): Convention | undefined {
    const row = this.db.prepare('SELECT * FROM conventions WHERE tag = ?').get(tag) as Record<string, unknown> | undefined;
    return row ? this.rowToConvention(row) : undefined;
  }

  conventionList(): Convention[] {
    const rows = this.db.prepare('SELECT * FROM conventions ORDER BY occurrences DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToConvention(r));
  }

  conventionDelete(tag: string): boolean {
    const result = this.db.prepare('DELETE FROM conventions WHERE tag = ?').run(tag);
    return result.changes > 0;
  }

  conventionIncrement(tag: string, symbolExample: string | null): void {
    this.db.prepare(`
      UPDATE conventions SET occurrences = occurrences + 1, last_seen = ?
      ${symbolExample ? ', symbol_examples = ?' : ''}
      WHERE tag = ?
    `).run(...(symbolExample ? [Date.now(), symbolExample, tag] : [Date.now(), tag]));
  }

  private rowToConvention(row: Record<string, unknown>): Convention {
    return {
      tag: row.tag as string,
      pattern_desc: row.pattern_desc as string,
      occurrences: row.occurrences as number,
      symbol_examples: row.symbol_examples as string | null,
      last_seen: row.last_seen as number,
    };
  }
```

同时在文件顶部 import 中加入：

```typescript
  DebtEntry, CodeAnnotationRecord, Convention, ReviewAction,
```

- [ ] **Step 3: 在 knowledge-store.impl.ts 的 import 补充 ReviewAction 类型**

确保 import 行包含（如果 `ReviewAction` 尚未导入）：

```typescript
import type {
  Symbol, SymbolId, SymbolKind, Language, Reference, CallGraph, CallDirection,
  FileIndexState, ProjectMeta, RuntimeRequirement, Dependency, QueryHistoryEntry,
  SessionState, AnnotationEntry, DebtEntry, CodeAnnotationRecord, Convention, ReviewAction,
} from '../common/types.js';
```

- [ ] **Step 4: 写失败测试**

在 `src/store/knowledge-store.test.ts` 末尾 `describe` 块内部追加：

```typescript
  // TC-UT-KS-DE-001: 理解债 upsert + get
  it('TC-UT-KS-DE-001: should upsert and get debt entry', () => {
    store.debtUpsert({
      symbol_id: 'sym-1', file_path: 'src/a.ts', debt: 3.5,
      change_recency: 2.0, difficulty: 0.8, examined_at: null, confirmed_at: null,
      updated_at: Date.now(),
    });
    const entry = store.debtGet('sym-1');
    expect(entry).toBeDefined();
    expect(entry!.debt).toBe(3.5);
    expect(entry!.file_path).toBe('src/a.ts');
  });

  // TC-UT-KS-DE-002: 确认后债值清零
  it('TC-UT-KS-DE-002: should clear debt on confirmed', () => {
    store.debtUpsert({
      symbol_id: 'sym-2', file_path: 'src/b.ts', debt: 4.0,
      change_recency: 2.0, difficulty: 0.9, examined_at: null, confirmed_at: null,
      updated_at: Date.now(),
    });
    store.debtUpdateConfirmed('sym-2', Date.now());
    const entry = store.debtGet('sym-2');
    expect(entry!.debt).toBe(0);
    expect(entry!.confirmed_at).not.toBeNull();
  });

  // TC-UT-KS-DE-003: 按文件查询 + top 查询
  it('TC-UT-KS-DE-003: should query by file and top', () => {
    store.debtUpsert({ symbol_id: 's1', file_path: 'f.ts', debt: 1.0, change_recency: 1, difficulty: 0.5, examined_at: null, confirmed_at: null, updated_at: Date.now() });
    store.debtUpsert({ symbol_id: 's2', file_path: 'f.ts', debt: 4.0, change_recency: 2, difficulty: 0.9, examined_at: null, confirmed_at: null, updated_at: Date.now() });
    store.debtUpsert({ symbol_id: 's3', file_path: 'g.ts', debt: 2.0, change_recency: 1, difficulty: 0.7, examined_at: null, confirmed_at: null, updated_at: Date.now() });
    expect(store.debtGetByFile('f.ts')).toHaveLength(2);
    const top = store.debtGetTop(2);
    expect(top[0]!.debt).toBeGreaterThanOrEqual(top[1]!.debt);
  });

  // TC-UT-KS-CA-001: 代码修正标注记录 + 查询
  it('TC-UT-KS-CA-001: should record and list code annotations', () => {
    const id = store.codeAnnotationRecord({
      ai_generated_code: 'const x = f();', human_modified_code: 'const x = f();\\nif (!x) return;',
      diff: '+if (!x) return;', symbols_involved: '["sym-1"]', annotation_tags: '["add_null_check"]',
      chunk_id: 'chunk-1', brief_field_hits: '["impact_radius"]', action: 'pass',
      debt_at_review: 3.2, created_at: new Date().toISOString(),
    });
    expect(id).toBeGreaterThan(0);
    const list = store.codeAnnotationList();
    expect(list).toHaveLength(1);
    expect(list[0]!.annotation_tags).toContain('add_null_check');
  });

  // TC-UT-KS-CV-001: 约定 upsert + increment + list
  it('TC-UT-KS-CV-001: should upsert, increment and list conventions', () => {
    store.conventionUpsert('add_null_check', '调用外部服务后未判空', 'PaymentService.charge');
    store.conventionIncrement('add_null_check', null);
    store.conventionIncrement('add_null_check', null);
    const conv = store.conventionGet('add_null_check');
    expect(conv).toBeDefined();
    expect(conv!.occurrences).toBe(2);
    expect(store.conventionList()).toHaveLength(1);
    expect(store.conventionDelete('add_null_check')).toBe(true);
    expect(store.conventionGet('add_null_check')).toBeUndefined();
  });
```

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run src/store/knowledge-store.test.ts`
Expected: 全部 PASS（包括原有 + 新增 5 个测试）

- [ ] **Step 6: 提交**

```bash
git add src/store/knowledge-store.ts src/store/knowledge-store.impl.ts src/store/knowledge-store.test.ts
git commit -m "feat(store): KnowledgeStore 理解债/代码修正/约定 CRUD"
```

---

### Task 4: 债值公式纯函数

**Files:**
- Create: `src/understanding-debt/debt-formula.ts`
- Test: `src/understanding-debt/debt-engine.test.ts` (仅公式测试部分，后续 Task 6 继续往里加)

**Interfaces:**
- Produces: `computeChangeRecency`, `computeDifficulty`, `computeDebt`, `debtToLevel` 纯函数

- [ ] **Step 1: 写失败测试**

创建 `src/understanding-debt/debt-engine.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { computeChangeRecency, computeDifficulty, computeDebt, debtToLevel } from './debt-formula.js';

describe('DebtFormula', () => {
  // TC-UT-DE-001: 变更近因 — 刚改过 recency 最大
  it('TC-UT-DE-001: changeRecency should be max for just-changed symbol', () => {
    const now = Date.now();
    const recency = computeChangeRecency([now], now, 7 * 24 * 3600 * 1000);
    expect(recency).toBeCloseTo(1.0, 2);
  });

  // TC-UT-DE-002: 变更近因 — 7 天前衰减到 1/e
  it('TC-UT-DE-002: changeRecency should decay to ~1/e after one tau', () => {
    const now = Date.now();
    const tau = 7 * 24 * 3600 * 1000;
    const recency = computeChangeRecency([now - tau], now, tau);
    expect(recency).toBeCloseTo(1 / Math.E, 2);
  });

  // TC-UT-DE-003: 难度 — complexity 和 blastRadius 各占一半
  it('TC-UT-DE-003: difficulty should be average of normalized complexity and blastRadius', () => {
    const difficulty = computeDifficulty(0.8, 0.6);
    expect(difficulty).toBeCloseTo(0.7, 2);
  });

  // TC-UT-DE-004: 债值 = recency × uncovered × difficulty
  it('TC-UT-DE-004: debt should be recency * uncovered * difficulty', () => {
    const debt = computeDebt(2.0, 1.0, 0.7);
    expect(debt).toBeCloseTo(1.4, 2);
  });

  // TC-UT-DE-005: examined 态减半 uncoveredRatio
  it('TC-UT-DE-005: examined state should halve uncoveredRatio', () => {
    const debt = computeDebt(2.0, 0.5, 0.7);
    expect(debt).toBeCloseTo(0.7, 2);
  });

  // TC-UT-DE-006: confirmed 态清零
  it('TC-UT-DE-006: confirmed state should zero debt', () => {
    const debt = computeDebt(2.0, 0.0, 0.7);
    expect(debt).toBeCloseTo(0.0, 2);
  });

  // TC-UT-DE-007: 债值分级
  it('TC-UT-DE-007: debtToLevel should map to green/yellow/red', () => {
    expect(debtToLevel(0.5)).toBe('green');
    expect(debtToLevel(2.0)).toBe('yellow');
    expect(debtToLevel(3.5)).toBe('red');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run src/understanding-debt/debt-engine.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建 debt-formula.ts**

创建 `src/understanding-debt/debt-formula.ts`：

```typescript
// ============================================================
// 理解债公式 — 纯函数，便于测试
// debt(symbol) = changeRecency × uncoveredRatio × difficulty
// ============================================================

/** 债值级别 */
export type DebtLevel = 'green' | 'yellow' | 'red';

/**
 * 计算变更近因 — 近期变更权重大，按指数衰减
 * @param changeTimes 符号历次变更时间戳列表
 * @param now 当前时间戳
 * @param tau 衰减时间常数（毫秒），默认 7 天
 * @returns 0–~5 的浮点数
 */
export function computeChangeRecency(
  changeTimes: number[],
  now: number,
  tau: number = 7 * 24 * 3600 * 1000,
): number {
  if (changeTimes.length === 0) return 0;
  return changeTimes.reduce((sum, t) => sum + Math.exp(-(now - t) / tau), 0);
}

/**
 * 计算难度 — complexity 和 blastRadius 各占一半（均已归一化到 0–1）
 */
export function computeDifficulty(
  normalizedComplexity: number,
  normalizedBlastRadius: number,
): number {
  return 0.5 * normalizedComplexity + 0.5 * normalizedBlastRadius;
}

/**
 * 计算债值
 * @param changeRecency 变更近因（0–~5）
 * @param uncoveredRatio 未审覆盖比（1=完全没看，0.5=看过简报，0=已确认）
 * @param difficulty 难度（0–1）
 */
export function computeDebt(
  changeRecency: number,
  uncoveredRatio: number,
  difficulty: number,
): number {
  return changeRecency * uncoveredRatio * difficulty;
}

/**
 * 债值转级别
 * <1 green / 1–3 yellow / >3 red
 */
export function debtToLevel(debt: number): DebtLevel {
  if (debt < 1) return 'green';
  if (debt <= 3) return 'yellow';
  return 'red';
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run src/understanding-debt/debt-engine.test.ts`
Expected: 7 个测试全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/understanding-debt/debt-formula.ts src/understanding-debt/debt-engine.test.ts
git commit -m "feat(debt): 债值公式纯函数 + 单元测试"
```

---

### Task 5: ChangeSensor

**Files:**
- Create: `src/change-sensor/change-sensor.ts`
- Create: `src/change-sensor/change-sensor.impl.ts`
- Create: `src/change-sensor/change-sensor.test.ts`

**Interfaces:**
- Consumes: `FileWatcher` (`onChange(handler)`), `GitIntelligence` (`diff`, `log`), `CodeIntelligence` (`findReferences` 用于符号提取)
- Produces: `ChangeSensor` 接口 + `DefaultChangeSensor` 实现，产出 `ChangeBatch`

- [ ] **Step 1: 创建接口文件**

创建 `src/change-sensor/change-sensor.ts`：

```typescript
import type { ChangeBatch } from '../common/types.js';

/**
 * 变更传感器 — 旁观者：监听 Git/文件变更，打包成 ChangeBatch
 */
export interface ChangeSensor {
  /** 启动监听 */
  start(projectRoot: string): void;
  /** 停止监听 */
  stop(): void;
  /** 注册批次回调 */
  onBatch(handler: (batch: ChangeBatch) => void): () => void;
  /** 手动触发一次检测（用于测试 / REPL 主动查询） */
  detect(projectRoot: string): Promise<ChangeBatch | null>;
}
```

- [ ] **Step 2: 写失败测试**

创建 `src/change-sensor/change-sensor.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { DefaultChangeSensor } from './change-sensor.impl.js';
import type { GitIntelligence } from '../git-intel/git-intelligence.js';
import { GitIntelligenceImpl } from '../git-intel/git-intelligence.impl.js';

describe('DefaultChangeSensor', () => {
  let projectRoot: string;
  let gitIntel: GitIntelligence;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'nodus-sensor-'));
    execSync('git init', { cwd: projectRoot, stdio: 'pipe' });
    execSync('git config user.email test@test.com && git config user.name test', { cwd: projectRoot, stdio: 'pipe' });
    writeFileSync(join(projectRoot, 'app.ts'), 'export function foo() { return 1; }\n');
    execSync('git add -A && git commit -m init', { cwd: projectRoot, stdio: 'pipe' });
    gitIntel = new GitIntelligenceImpl();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // TC-UT-CS-001: detect 应返回含改动的 ChangeBatch
  it('TC-UT-CS-001: detect should return ChangeBatch with changed files', async () => {
    // 模拟 AI 改文件
    writeFileSync(join(projectRoot, 'app.ts'), 'export function foo() { return 2; }\nexport function bar() { return 3; }\n');
    writeFileSync(join(projectRoot, 'util.ts'), 'export function util() { return 0; }\n');

    const sensor = new DefaultChangeSensor(gitIntel);
    const batch = await sensor.detect(projectRoot);

    expect(batch).not.toBeNull();
    expect(batch!.files).toContain('app.ts');
    expect(batch!.files).toContain('util.ts');
    expect(batch!.detected_at).toBeDefined();
    expect(batch!.id).toBeDefined();
  });

  // TC-UT-CS-002: 无变更时返回 null
  it('TC-UT-CS-002: detect should return null when no changes', async () => {
    const sensor = new DefaultChangeSensor(gitIntel);
    const batch = await sensor.detect(projectRoot);
    expect(batch).toBeNull();
  });

  // TC-UT-CS-003: snapshot 应包含改动文件的内容
  it('TC-UT-CS-003: snapshot should contain file content after change', async () => {
    writeFileSync(join(projectRoot, 'app.ts'), 'export function foo() { return 42; }\n');
    const sensor = new DefaultChangeSensor(gitIntel);
    const batch = await sensor.detect(projectRoot);
    expect(batch).not.toBeNull();
    expect(batch!.snapshot['app.ts']).toContain('42');
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

Run: `npx vitest run src/change-sensor/change-sensor.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 4: 创建实现文件**

创建 `src/change-sensor/change-sensor.impl.ts`：

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ChangeBatch, ChangedSymbol } from '../common/types.js';
import type { ChangeSensor } from './change-sensor.js';
import type { GitIntelligence } from '../git-intel/git-intelligence.js';

/**
 * 默认变更传感器 — 通过 git diff 检测工作树变更
 */
export class DefaultChangeSensor implements ChangeSensor {
  private emitter = new EventEmitter();

  constructor(private gitIntel: GitIntelligence) {}

  start(_projectRoot: string): void {
    // P1: detect() 由 REPL 主动调用；start/stop 预留给 FileWatcher 集成
  }

  stop(): void {
    this.emitter.removeAllListeners();
  }

  onBatch(handler: (batch: ChangeBatch) => void): () => void {
    this.emitter.on('batch', handler);
    return () => this.emitter.off('batch', handler);
  }

  async detect(projectRoot: string): Promise<ChangeBatch | null> {
    const changedFiles = this.getChangedFiles(projectRoot);
    if (changedFiles.length === 0) return null;

    const symbols = this.extractChangedSymbols(projectRoot, changedFiles);
    const snapshot: Record<string, string> = {};
    for (const file of changedFiles) {
      const absPath = join(projectRoot, file);
      if (existsSync(absPath)) {
        snapshot[file] = readFileSync(absPath, 'utf-8');
      }
    }

    const batch: ChangeBatch = {
      id: `batch-${Date.now()}-${changedFiles.length}`,
      project_root: projectRoot,
      detected_at: new Date().toISOString(),
      files: changedFiles,
      symbols,
      snapshot,
    };

    this.emitter.emit('batch', batch);
    return batch;
  }

  /** 获取工作树相对于 HEAD 的变更文件列表 */
  private getChangedFiles(projectRoot: string): string[] {
    try {
      const output = execSync('git diff --name-only HEAD', {
        cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe',
      });
      const tracked = output.trim().split('\n').filter(Boolean);

      const untrackedOutput = execSync('git ls-files --others --exclude-standard', {
        cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe',
      });
      const untracked = untrackedOutput.trim().split('\n').filter(Boolean);

      return [...tracked, ...untracked];
    } catch {
      return [];
    }
  }

  /** 从 diff 中提取被改动的符号名（简化版：按行匹配 function/class 声明） */
  private extractChangedSymbols(projectRoot: string, files: string[]): ChangedSymbol[] {
    const symbols: ChangedSymbol[] = [];
    for (const file of files) {
      const absPath = join(projectRoot, file);
      if (!existsSync(absPath)) continue;
      const content = readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 简化匹配：TS/JS function/class 声明
        const match = line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let)\s+(\w+)/);
        if (match) {
          symbols.push({
            symbol_id: `${file}:${match[1]}`,
            name: match[1],
            file_path: file,
            line_start: i + 1,
            line_end: i + 1,
            diff_text: line,
          });
        }
      }
    }
    return symbols;
  }
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run src/change-sensor/change-sensor.test.ts`
Expected: 3 个测试全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/change-sensor/
git commit -m "feat(change-sensor): 变更传感器 — git diff 检测 + 符号提取"
```

---

### Task 6: DebtEngine 实现

**Files:**
- Create: `src/understanding-debt/debt-engine.ts`
- Create: `src/understanding-debt/debt-engine.impl.ts`
- Modify: `src/understanding-debt/debt-engine.test.ts` (追加测试)

**Interfaces:**
- Consumes: `KnowledgeStore` (`debtUpsert/Get/GetByFile/GetTop/UpdateExamined/UpdateConfirmed`), `CodeAnalytics` (`complexityScores`), `CodeIntelligence` (`impactAnalysis`), `debt-formula.ts` 纯函数
- Produces: `DebtEngine` 接口 + `DebtEngineImpl` 实现

- [ ] **Step 1: 创建接口文件**

创建 `src/understanding-debt/debt-engine.ts`：

```typescript
import type { ChangeBatch, DebtEntry } from '../common/types.js';
import type { DebtLevel } from './debt-formula.js';

/** 理解债查询结果 */
export interface DebtQueryResult {
  symbol_id: string;
  name: string;
  file_path: string;
  debt: number;
  level: DebtLevel;
  examined: boolean;
  confirmed: boolean;
}

/**
 * 理解债引擎 — 计算和持久化每个符号的"理解债"
 */
export interface DebtEngine {
  /** 收到变更批次后重算受影响符号的债值 */
  recompute(batch: ChangeBatch): Promise<void>;
  /** 查询项目内债值最高的符号 */
  getTopDebt(limit: number): DebtQueryResult[];
  /** 查询某文件的债值列表 */
  getDebtByFile(filePath: string): DebtQueryResult[];
  /** 标记符号已审视（隐式 examined） */
  markExamined(symbolId: string): void;
  /** 确认符号已审完（显式 confirmed，清零债值） */
  confirmReviewed(symbolId: string): void;
  /** 每日衰减 */
  decay(): number;
}
```

- [ ] **Step 2: 在 debt-engine.test.ts 追加测试**

在 `src/understanding-debt/debt-engine.test.ts` 末尾追加：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database as DatabaseType } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../store/migrations.js';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { DebtEngineImpl } from './debt-engine.impl.js';
import type { ChangeBatch } from '../common/types.js';

describe('DebtEngineImpl', () => {
  let db: DatabaseType;
  let dbPath: string;
  let store: SqliteKnowledgeStore;

  beforeEach(() => {
    dbPath = join(tmpdir(), `nodus-debt-test-${Date.now()}.db`);
    db = new Database(dbPath);
    new MigrationRunner(db).run();
    store = new SqliteKnowledgeStore(dbPath);
  });

  afterEach(() => {
    store.close();
    db.close();
    rmSync(dbPath, { force: true });
  });

  // TC-UT-DE-010: recompute 应为变更符号写入债值
  it('TC-UT-DE-010: recompute should write debt for changed symbols', async () => {
    const engine = new DebtEngineImpl(store);
    const batch: ChangeBatch = {
      id: 'test-1', project_root: '/test', detected_at: new Date().toISOString(),
      files: ['a.ts'],
      symbols: [{
        symbol_id: 'a.ts:foo', name: 'foo', file_path: 'a.ts',
        line_start: 1, line_end: 1, diff_text: 'function foo() {}',
      }],
      snapshot: { 'a.ts': 'function foo() {}' },
    };
    await engine.recompute(batch);
    const top = engine.getTopDebt(10);
    expect(top.length).toBeGreaterThan(0);
    expect(top[0]!.symbol_id).toBe('a.ts:foo');
    expect(top[0]!.debt).toBeGreaterThan(0);
  });

  // TC-UT-DE-011: confirmReviewed 应清零债值
  it('TC-UT-DE-011: confirmReviewed should clear debt', async () => {
    const engine = new DebtEngineImpl(store);
    const batch: ChangeBatch = {
      id: 'test-2', project_root: '/test', detected_at: new Date().toISOString(),
      files: ['b.ts'],
      symbols: [{
        symbol_id: 'b.ts:bar', name: 'bar', file_path: 'b.ts',
        line_start: 1, line_end: 1, diff_text: 'function bar() {}',
      }],
      snapshot: { 'b.ts': 'function bar() {}' },
    };
    await engine.recompute(batch);
    engine.confirmReviewed('b.ts:bar');
    const top = engine.getTopDebt(10);
    const entry = top.find(e => e.symbol_id === 'b.ts:bar');
    expect(entry!.debt).toBe(0);
    expect(entry!.confirmed).toBe(true);
  });

  // TC-UT-DE-012: markExamined 应减半债值
  it('TC-UT-DE-012: markExamined should halve uncoveredRatio', async () => {
    const engine = new DebtEngineImpl(store);
    const batch: ChangeBatch = {
      id: 'test-3', project_root: '/test', detected_at: new Date().toISOString(),
      files: ['c.ts'],
      symbols: [{
        symbol_id: 'c.ts:baz', name: 'baz', file_path: 'c.ts',
        line_start: 1, line_end: 1, diff_text: 'function baz() {}',
      }],
      snapshot: { 'c.ts': 'function baz() {}' },
    };
    await engine.recompute(batch);
    const before = engine.getTopDebt(10).find(e => e.symbol_id === 'c.ts:baz');
    engine.markExamined('c.ts:baz');
    const after = engine.getTopDebt(10).find(e => e.symbol_id === 'c.ts:baz');
    // examined 后 uncoveredRatio 从 1.0 降到 0.5，所以 debt 减半
    expect(after!.debt).toBeLessThan(before!.debt);
    expect(after!.examined).toBe(true);
  });

  // TC-UT-DE-013: getDebtByFile 按文件查询
  it('TC-UT-DE-013: getDebtByFile should filter by file', async () => {
    const engine = new DebtEngineImpl(store);
    const batch: ChangeBatch = {
      id: 'test-4', project_root: '/test', detected_at: new Date().toISOString(),
      files: ['x.ts', 'y.ts'],
      symbols: [
        { symbol_id: 'x.ts:f1', name: 'f1', file_path: 'x.ts', line_start: 1, line_end: 1, diff_text: '' },
        { symbol_id: 'y.ts:f2', name: 'f2', file_path: 'y.ts', line_start: 1, line_end: 1, diff_text: '' },
      ],
      snapshot: {},
    };
    await engine.recompute(batch);
    const xDebts = engine.getDebtByFile('x.ts');
    expect(xDebts.every(d => d.file_path === 'x.ts')).toBe(true);
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

Run: `npx vitest run src/understanding-debt/debt-engine.test.ts`
Expected: 公式测试 PASS，DebtEngineImpl 测试 FAIL（模块不存在）

- [ ] **Step 4: 创建实现文件**

创建 `src/understanding-debt/debt-engine.impl.ts`：

```typescript
import type { ChangeBatch } from '../common/types.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { DebtEngine, DebtQueryResult } from './debt-engine.js';
import { computeChangeRecency, computeDifficulty, computeDebt, debtToLevel, type DebtLevel } from './debt-formula.js';

/**
 * 理解债引擎实现
 * debt(symbol) = changeRecency × uncoveredRatio × difficulty
 */
export class DebtEngineImpl implements DebtEngine {
  private readonly tau = 7 * 24 * 3600 * 1000; // 7 天衰减

  constructor(private store: KnowledgeStore) {}

  async recompute(batch: ChangeBatch): Promise<void> {
    const now = Date.now();

    for (const sym of batch.symbols) {
      // 变更近因：用批次检测时间作为最近一次变更
      const changeRecency = computeChangeRecency([now], now, this.tau);

      // 难度：无 analytics 时用默认值（complexity 和 blastRadius 都取 0.5）
      // P1 简化：尚未接 CodeAnalytics/ImpactAnalysis 的 async 接口，用启发式
      const difficulty = this.estimateDifficulty(sym);

      // 未审覆盖比：新符号默认 1.0（完全没看）
      const existing = this.store.debtGet(sym.symbol_id);
      const uncoveredRatio = existing?.confirmed_at ? 0 : (existing?.examined_at ? 0.5 : 1.0);

      const debt = computeDebt(changeRecency, uncoveredRatio, difficulty);

      this.store.debtUpsert({
        symbol_id: sym.symbol_id,
        file_path: sym.file_path,
        debt,
        change_recency: changeRecency,
        difficulty,
        examined_at: existing?.examined_at ?? null,
        confirmed_at: existing?.confirmed_at ?? null,
        updated_at: now,
      });
    }
  }

  getTopDebt(limit: number): DebtQueryResult[] {
    return this.store.debtGetTop(limit).map(e => this.toQueryResult(e));
  }

  getDebtByFile(filePath: string): DebtQueryResult[] {
    return this.store.debtGetByFile(filePath).map(e => this.toQueryResult(e));
  }

  markExamined(symbolId: string): void {
    this.store.debtUpdateExamined(symbolId, Date.now());
    // 重新计算债值（examined 后 uncoveredRatio 减半）
    const entry = this.store.debtGet(symbolId);
    if (entry && !entry.confirmed_at) {
      const uncoveredRatio = 0.5;
      const debt = computeDebt(entry.change_recency, uncoveredRatio, entry.difficulty);
      this.store.debtUpsert({ ...entry, debt, examined_at: Date.now(), updated_at: Date.now() });
    }
  }

  confirmReviewed(symbolId: string): void {
    this.store.debtUpdateConfirmed(symbolId, Date.now());
  }

  decay(): number {
    const decayFactor = Math.exp(-1 / 7); // 每天衰减
    return this.store.debtDecayAll(decayFactor);
  }

  /** 估算难度 — P1 启发式：diff 行数多 → 复杂度高 */
  private estimateDifficulty(sym: { diff_text: string; name: string }): number {
    const diffLines = sym.diff_text.split('\n').length;
    const complexity = Math.min(diffLines / 50, 1.0); // 50 行封顶
    const blastRadius = 0.5; // P1 默认中等；后续接 ImpactAnalysis
    return computeDifficulty(complexity, blastRadius);
  }

  private toQueryResult(entry: import('../common/types.js').DebtEntry): DebtQueryResult {
    const level: DebtLevel = debtToLevel(entry.debt);
    const name = entry.symbol_id.split(':').pop() ?? entry.symbol_id;
    return {
      symbol_id: entry.symbol_id,
      name,
      file_path: entry.file_path,
      debt: entry.debt,
      level,
      examined: entry.examined_at !== null,
      confirmed: entry.confirmed_at !== null,
    };
  }
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run src/understanding-debt/debt-engine.test.ts`
Expected: 全部 PASS（公式 7 + 实现 4 = 11 个测试）

- [ ] **Step 6: 提交**

```bash
git add src/understanding-debt/debt-engine.ts src/understanding-debt/debt-engine.impl.ts src/understanding-debt/debt-engine.test.ts
git commit -m "feat(debt): DebtEngine 实现 — 债值计算/持久化/两态切换"
```

---

### Task 7: SemanticChunker

**Files:**
- Create: `src/semantic-chunk/semantic-chunker.ts`
- Create: `src/semantic-chunk/brief-template.ts`
- Create: `src/semantic-chunk/semantic-chunker.impl.ts`
- Create: `src/semantic-chunk/semantic-chunker.test.ts`

**Interfaces:**
- Consumes: `ChangeBatch.symbols` (ChangedSymbol[]), `CallGraphEdge[]` (from store), `CodeReviewer` (`reviewDiff`), `CodeAnalytics` (`complexityScores`)
- Produces: `SemanticChunker` 接口 + 实现，产出 `SemanticChunk[]` 和 `BriefCard[]`

- [ ] **Step 1: 创建接口文件**

创建 `src/semantic-chunk/semantic-chunker.ts`：

```typescript
import type { ChangeBatch, SemanticChunk, BriefCard } from '../common/types.js';

/**
 * 语义切片器 — 按调用图连通性聚类变更符号，生成简报
 */
export interface SemanticChunker {
  /** 将变更批次的符号聚类为语义块 */
  chunk(batch: ChangeBatch): SemanticChunk[];
  /** 为语义块生成简报卡 */
  brief(chunk: SemanticChunk, batch: ChangeBatch): BriefCard;
}
```

- [ ] **Step 2: 创建简报模板**

创建 `src/semantic-chunk/brief-template.ts`：

```typescript
import type { SemanticChunk, BriefCard, ChangedSymbol } from '../common/types.js';
import type { RiskLevel } from '../common/types.js';

/**
 * 装配简报卡字段 — 全部从已有数据派生
 */
export function assembleBrief(
  chunk: SemanticChunk,
  symbols: ChangedSymbol[],
  impactRadius: number,
  riskLevel: RiskLevel,
  complexityMap: Map<string, number>,
  hasTestCoverage: boolean,
  knownIssues: string[],
): BriefCard {
  const symbolComplexities = chunk.symbols.map(s => ({
    name: s.name,
    complexity: complexityMap.get(s.symbol_id) ?? 0,
  }));

  const hotspots = symbolComplexities
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 2)
    .map(s => s.name);

  const inspectSym = chunk.symbols
    .slice()
    .sort((a, b) => (complexityMap.get(b.symbol_id) ?? 0) - (complexityMap.get(a.symbol_id) ?? 0))[0];

  return {
    chunk_id: chunk.id,
    title: chunk.title,
    symbols: symbolComplexities,
    impact_radius: impactRadius,
    risk_level: riskLevel,
    complexity_hotspots: hotspots,
    test_coverage: hasTestCoverage,
    known_issues: knownIssues,
    suggested_inspect_point: inspectSym
      ? { file: inspectSym.file_path, line: inspectSym.line_start }
      : null,
  };
}
```

- [ ] **Step 3: 写失败测试**

创建 `src/semantic-chunk/semantic-chunker.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { SemanticChunkerImpl } from './semantic-chunker.impl.js';
import type { ChangeBatch, ChangedSymbol } from '../common/types.js';

function makeSymbol(id: string, name: string, file: string): ChangedSymbol {
  return { symbol_id: id, name, file_path: file, line_start: 1, line_end: 5, diff_text: `function ${name}() {}` };
}

function makeBatch(symbols: ChangedSymbol[]): ChangeBatch {
  return {
    id: 'test-batch', project_root: '/test', detected_at: new Date().toISOString(),
    files: [...new Set(symbols.map(s => s.file_path))], symbols,
    snapshot: {},
  };
}

describe('SemanticChunkerImpl', () => {
  // TC-UT-SC-001: 同文件符号应聚为一块
  it('TC-UT-SC-001: symbols in same file should cluster together', () => {
    const chunker = new SemanticChunkerImpl();
    const batch = makeBatch([
      makeSymbol('a.ts:foo', 'foo', 'a.ts'),
      makeSymbol('a.ts:bar', 'bar', 'a.ts'),
    ]);
    const chunks = chunker.chunk(batch);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.symbols).toHaveLength(2);
  });

  // TC-UT-SC-002: 不同文件不同模块应分块
  it('TC-UT-SC-002: symbols in different dirs should split', () => {
    const chunker = new SemanticChunkerImpl();
    const batch = makeBatch([
      makeSymbol('src/payment/charge.ts:charge', 'charge', 'src/payment/charge.ts'),
      makeSymbol('src/auth/login.ts:login', 'login', 'src/auth/login.ts'),
    ]);
    const chunks = chunker.chunk(batch);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  // TC-UT-SC-003: 简报字段非空
  it('TC-UT-SC-003: brief card should have all fields', () => {
    const chunker = new SemanticChunkerImpl();
    const batch = makeBatch([makeSymbol('a.ts:foo', 'foo', 'a.ts')]);
    const chunks = chunker.chunk(batch);
    const brief = chunker.brief(chunks[0]!, batch);
    expect(brief.title).toBeDefined();
    expect(brief.symbols).toHaveLength(1);
    expect(brief.risk_level).toBeDefined();
    expect(brief.suggested_inspect_point).not.toBeNull();
  });

  // TC-UT-SC-004: 超过 8 个符号应子聚类
  it('TC-UT-SC-004: more than 8 symbols should sub-cluster', () => {
    const chunker = new SemanticChunkerImpl();
    const symbols: ChangedSymbol[] = [];
    for (let i = 0; i < 12; i++) {
      symbols.push(makeSymbol(`a.ts:f${i}`, `f${i}`, 'a.ts'));
    }
    const batch = makeBatch(symbols);
    const chunks = chunker.chunk(batch);
    const maxChunkSize = Math.max(...chunks.map(c => c.symbols.length));
    expect(maxChunkSize).toBeLessThanOrEqual(8);
  });
});
```

- [ ] **Step 4: 运行测试验证失败**

Run: `npx vitest run src/semantic-chunk/semantic-chunker.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 5: 创建实现文件**

创建 `src/semantic-chunk/semantic-chunker.impl.ts`：

```typescript
import type { ChangeBatch, SemanticChunk, BriefCard, ChangedSymbol, RiskLevel } from '../common/types.js';
import type { SemanticChunker } from './semantic-chunker.js';
import { assembleBrief } from './brief-template.js';

const MAX_CHUNK_SIZE = 8;

/**
 * 语义切片器实现 — 按文件+模块目录聚类，超过大小上限时子聚类
 * P1 简化版：无调用图时按文件目录连通性聚类（同一文件/同一一级目录归一块）
 */
export class SemanticChunkerImpl implements SemanticChunker {
  chunk(batch: ChangeBatch): SemanticChunk[] {
    if (batch.symbols.length === 0) return [];

    // 按一级模块目录分组
    const groups = new Map<string, ChangedSymbol[]>();
    for (const sym of batch.symbols) {
      const moduleDir = this.getModuleDir(sym.file_path);
      const key = moduleDir;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(sym);
    }

    // 对每个组做子聚类（控制块大小）
    const chunks: SemanticChunk[] = [];
    let chunkIndex = 0;
    for (const [moduleDir, syms] of groups) {
      if (syms.length <= MAX_CHUNK_SIZE) {
        chunks.push(this.makeChunk(`chunk-${chunkIndex++}`, syms, moduleDir));
      } else {
        // 按 8 个一组切
        for (let i = 0; i < syms.length; i += MAX_CHUNK_SIZE) {
          const slice = syms.slice(i, i + MAX_CHUNK_SIZE);
          chunks.push(this.makeChunk(`chunk-${chunkIndex++}`, slice, moduleDir));
        }
      }
    }
    return chunks;
  }

  brief(chunk: SemanticChunk, _batch: ChangeBatch): BriefCard {
    const complexityMap = new Map<string, number>();
    for (const s of chunk.symbols) {
      // P1 启发式：diff 行数作为复杂度代理
      complexityMap.set(s.symbol_id, Math.min(s.diff_text.split('\n').length, 10));
    }

    const impactRadius = chunk.files.length * 2; // P1 简化
    const riskLevel: RiskLevel = chunk.symbols.length > 5 ? 'high' : chunk.symbols.length > 2 ? 'medium' : 'low';

    return assembleBrief(
      chunk,
      chunk.symbols,
      impactRadius,
      riskLevel,
      complexityMap,
      false, // P1 简化：暂不查测试覆盖
      [],    // P1 简化：暂不查已知隐患
    );
  }

  private makeChunk(id: string, syms: ChangedSymbol[], moduleDir: string): SemanticChunk {
    const files = [...new Set(syms.map(s => s.file_path))];
    const mostFreqName = this.mostFrequent(syms.map(s => s.name));
    return {
      id,
      symbols: syms,
      files,
      title: `${mostFreqName} @ ${moduleDir}`,
    };
  }

  private getModuleDir(filePath: string): string {
    const parts = filePath.split('/');
    if (parts.length <= 1) return parts[0] ?? 'root';
    if (parts[0] === 'src' && parts.length > 2) return parts.slice(0, 2).join('/');
    return parts[0] ?? 'root';
  }

  private mostFrequent(arr: string[]): string {
    const counts = new Map<string, number>();
    for (const s of arr) counts.set(s, (counts.get(s) ?? 0) + 1);
    let max = '';
    let maxCount = 0;
    for (const [s, c] of counts) {
      if (c > maxCount) { max = s; maxCount = c; }
    }
    return max;
  }
}
```

- [ ] **Step 6: 运行测试验证通过**

Run: `npx vitest run src/semantic-chunk/semantic-chunker.test.ts`
Expected: 4 个测试全部 PASS

- [ ] **Step 7: 提交**

```bash
git add src/semantic-chunk/
git commit -m "feat(chunk): 语义切片器 — 按模块聚类 + 简报卡生成"
```

---

### Task 8: Tag 分类器

**Files:**
- Create: `src/alignment/tag-classifier.ts`
- Create: `src/alignment/tag-classifier.test.ts`

**Interfaces:**
- Produces: `classifyDiff(before, after)` → `string[]` (tag 列表)

- [ ] **Step 1: 写失败测试**

创建 `src/alignment/tag-classifier.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { classifyDiff } from './tag-classifier.js';

describe('TagClassifier', () => {
  // TC-UT-TC-001: 新增 null 检查
  it('TC-UT-TC-001: should detect add_null_check', () => {
    const before = 'const result = service.call();\nreturn result;';
    const after = 'const result = service.call();\nif (!result) return null;\nreturn result;';
    const tags = classifyDiff(before, after);
    expect(tags).toContain('add_null_check');
  });

  // TC-UT-TC-002: 新增 try/catch
  it('TC-UT-TC-002: should detect add_error_handling', () => {
    const before = 'const data = JSON.parse(str);\nreturn data;';
    const after = 'try {\n  const data = JSON.parse(str);\n  return data;\n} catch (e) {\n  return null;\n}';
    const tags = classifyDiff(before, after);
    expect(tags).toContain('add_error_handling');
  });

  // TC-UT-TC-003: 删除 console.log
  it('TC-UT-TC-003: should detect remove_debug', () => {
    const before = 'console.log("debug", x);\nreturn x;';
    const after = 'return x;';
    const tags = classifyDiff(before, after);
    expect(tags).toContain('remove_debug');
  });

  // TC-UT-TC-004: 新增类型标注
  it('TC-UT-TC-004: should detect add_type', () => {
    const before = 'function foo(x) { return x; }';
    const after = 'function foo(x: number): number { return x; }';
    const tags = classifyDiff(before, after);
    expect(tags).toContain('add_type');
  });

  // TC-UT-TC-005: 无变化时返回空数组
  it('TC-UT-TC-005: should return empty for no change', () => {
    const tags = classifyDiff('let x = 1;', 'let x = 1;');
    expect(tags).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run src/alignment/tag-classifier.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建实现文件**

创建 `src/alignment/tag-classifier.ts`：

```typescript
// ============================================================
// 修正 tag 分类器 — 基于 diff 的启发式规则匹配
// ============================================================

/**
 * 分析 before / after 文本差异，返回修正 tag 列表
 */
export function classifyDiff(before: string, after: string): string[] {
  const tags: string[] = [];
  const addedLines = extractAddedLines(before, after);
  const removedLines = extractRemovedLines(before, after);

  // add_null_check: 新增了 null/undefined 判断
  if (addedLines.some(l => /if\s*\(\s*!?\w+\s*(===?|!==?)\s*(null|undefined)\)/.test(l) || /if\s*\(\s*!\w+\s*\)/.test(l))) {
    if (removedLines.every(l => !/if\s*\(\s*!?\w+\s*(===?|!==?)\s*(null|undefined)\)/.test(l))) {
      tags.push('add_null_check');
    }
  }

  // add_error_handling: 新增了 try/catch 或 except
  if (addedLines.some(l => /try\s*\{|catch\s*\(|except\s*:/.test(l))) {
    if (removedLines.every(l => !/try\s*\{|catch\s*\(/.test(l))) {
      tags.push('add_error_handling');
    }
  }

  // add_type: 新增了类型标注（: Type 或 <Type>）
  if (addedLines.some(l => /:\s*(number|string|boolean|any|void|never|unknown)\b/.test(l))
      && removedLines.some(l => !/:\s*(number|string|boolean|any|void|never|unknown)\b/.test(l))) {
    tags.push('add_type');
  }

  // remove_debug: 删除了 console.log / debugger
  if (removedLines.some(l => /console\.(log|debug|info|warn|error)\s*\(/.test(l) || /\bdebugger\b/.test(l))) {
    tags.push('remove_debug');
  }

  // rename_symbol: 函数/变量名变化
  const beforeNameMatch = before.match(/(?:function|const|let|var)\s+(\w+)/);
  const afterNameMatch = after.match(/(?:function|const|let|var)\s+(\w+)/);
  if (beforeNameMatch && afterNameMatch && beforeNameMatch[1] !== afterNameMatch[1]) {
    tags.push('rename_symbol');
  }

  // extract_function: 新增了函数声明且 after 行数明显增多
  if (addedLines.filter(l => /function\s+\w+|=>\s*{/.test(l)).length > 0 && after.split('\n').length > before.split('\n').length + 3) {
    tags.push('extract_function');
  }

  // revert: after 行数显著少于 before
  if (after.split('\n').length < before.split('\n').length * 0.6) {
    tags.push('revert');
  }

  // simplify: 删除了冗余分支（删除行数 > 新增行数且无上述模式）
  if (removedLines.length > addedLines.length * 2 && tags.length === 0) {
    tags.push('simplify');
  }

  return tags;
}

/** 提取 after 中新增的行（不在 before 中） */
function extractAddedLines(before: string, after: string): string[] {
  const beforeSet = new Set(before.split('\n').map(l => l.trim()));
  return after.split('\n').filter(l => !beforeSet.has(l.trim())).filter(l => l.trim().length > 0);
}

/** 提取 before 中删除的行（不在 after 中） */
function extractRemovedLines(before: string, after: string): string[] {
  const afterSet = new Set(after.split('\n').map(l => l.trim()));
  return before.split('\n').filter(l => !afterSet.has(l.trim())).filter(l => l.trim().length > 0);
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run src/alignment/tag-classifier.test.ts`
Expected: 5 个测试全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/alignment/tag-classifier.ts src/alignment/tag-classifier.test.ts
git commit -m "feat(alignment): 修正 tag 分类器 — diff 启发式规则匹配"
```

---

### Task 9: Conventions 发射器

**Files:**
- Create: `src/alignment/conventions-emitter.ts`
- Create: `src/alignment/emitters/nodus-md-emitter.ts`
- Create: `src/alignment/alignment-flywheel.test.ts` (发射器测试部分)

**Interfaces:**
- Consumes: `Convention[]`
- Produces: `ConventionsEmitter` 接口 + `NodusMdEmitter` 实现

- [ ] **Step 1: 创建接口文件**

创建 `src/alignment/conventions-emitter.ts`：

```typescript
import type { Convention } from '../common/types.js';

/**
 * 约定发射器 — 把修正模式写入文件反喂 AI 工具
 */
export interface ConventionsEmitter {
  /** 发射器名称 */
  readonly name: string;
  /** 目标文件路径（相对项目根） */
  readonly targetPath: string;
  /** 将约定列表渲染为文件内容 */
  render(conventions: Convention[]): string;
}
```

- [ ] **Step 2: 创建 NodusMd 发射器**

创建 `src/alignment/emitters/nodus-md-emitter.ts`：

```typescript
import type { Convention } from '../../common/types.js';
import type { ConventionsEmitter } from '../conventions-emitter.js';

/**
 * .nodus/conventions.md 发射器 — 默认约定文件格式
 */
export class NodusMdEmitter implements ConventionsEmitter {
  readonly name = 'nodus-md';
  readonly targetPath = '.nodus/conventions.md';

  render(conventions: Convention[]): string {
    if (conventions.length === 0) {
      return '# 项目约定（由 NodusOS 从人工修正中提炼）\n\n暂无已记录的模式。\n';
    }

    let out = '# 项目约定（由 NodusOS 从人工修正中提炼）\n\n';
    out += '## 已知需人工修正的模式\n\n';
    for (const conv of conventions) {
      out += `- **${conv.tag}**: "${conv.pattern_desc}" 出现 ${conv.occurrences} 次\n`;
      if (conv.symbol_examples) {
        out += `  示例符号: ${conv.symbol_examples}\n`;
      }
    }
    out += '\n<!-- 由 NodusOS 自动生成，可通过 /prune 删除过时项 -->\n';
    return out;
  }
}
```

- [ ] **Step 3: 写测试**

创建 `src/alignment/alignment-flywheel.test.ts`（仅发射器部分，后续 Task 10 继续追加）：

```typescript
import { describe, it, expect } from 'vitest';
import { NodusMdEmitter } from './emitters/nodus-md-emitter.js';
import type { Convention } from '../common/types.js';

describe('NodusMdEmitter', () => {
  // TC-UT-AF-001: 渲染非空约定列表
  it('TC-UT-AF-001: should render conventions list', () => {
    const emitter = new NodusMdEmitter();
    const conventions: Convention[] = [
      { tag: 'add_null_check', pattern_desc: '调用外部服务后未判空', occurrences: 5, symbol_examples: 'PaymentService.charge', last_seen: Date.now() },
      { tag: 'add_type', pattern_desc: '函数参数未标注类型', occurrences: 3, symbol_examples: null, last_seen: Date.now() },
    ];
    const output = emitter.render(conventions);
    expect(output).toContain('add_null_check');
    expect(output).toContain('出现 5 次');
    expect(output).toContain('PaymentService.charge');
    expect(output).toContain('add_type');
  });

  // TC-UT-AF-002: 空列表渲染占位
  it('TC-UT-AF-002: should render placeholder for empty list', () => {
    const emitter = new NodusMdEmitter();
    const output = emitter.render([]);
    expect(output).toContain('暂无');
  });
});
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run src/alignment/alignment-flywheel.test.ts`
Expected: 2 个测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src/alignment/conventions-emitter.ts src/alignment/emitters/ src/alignment/alignment-flywheel.test.ts
git commit -m "feat(alignment): ConventionsEmitter 接口 + NodusMdEmitter"
```

---

### Task 10: AlignmentFlywheel 实现

**Files:**
- Create: `src/alignment/alignment-flywheel.ts`
- Create: `src/alignment/alignment-flywheel.impl.ts`
- Modify: `src/alignment/alignment-flywheel.test.ts` (追加实现测试)

**Interfaces:**
- Consumes: `KnowledgeStore` (`codeAnnotationRecord/ conventionUpsert/conventionIncrement/conventionList`), `tag-classifier.ts` (`classifyDiff`), `ConventionsEmitter` (`render`)
- Produces: `AlignmentFlywheel` 接口 + 实现

- [ ] **Step 1: 创建接口文件**

创建 `src/alignment/alignment-flywheel.ts`：

```typescript
import type { ReviewAction } from '../common/types.js';

/** 修正捕获输入 */
export interface CorrectionCapture {
  snapshot: string;
  after: string;
  symbols_involved: string[];
  chunk_id: string | null;
  brief_field_hits: string[];
  action: ReviewAction;
  debt_at_review: number | null;
}

/**
 * 对齐飞轮 — 捕获修正信号 + 双向反哺
 */
export interface AlignmentFlywheel {
  /** 捕获一次人工修正 */
  capture(input: CorrectionCapture): void;
  /** 发射 conventions 文件到项目目录 */
  emitConventions(projectRoot: string): void;
  /** 列出当前约定 */
  listConventions(): import('../common/types.js').Convention[];
  /** 删除过时约定 */
  prune(tag: string): boolean;
}
```

- [ ] **Step 2: 追加测试**

在 `src/alignment/alignment-flywheel.test.ts` 追加：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../store/migrations.js';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { AlignmentFlywheelImpl } from './alignment-flywheel.impl.js';
import { NodusMdEmitter } from './emitters/nodus-md-emitter.js';

describe('AlignmentFlywheelImpl', () => {
  let dbPath: string;
  let store: SqliteKnowledgeStore;
  let projectRoot: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `nodus-flywheel-test-${Date.now()}.db`);
    const db = new Database(dbPath);
    new MigrationRunner(db).run();
    db.close();
    store = new SqliteKnowledgeStore(dbPath);
    projectRoot = mkdtempSync(join(tmpdir(), 'nodus-flywheel-proj-'));
  });

  afterEach(() => {
    store.close();
    rmSync(dbPath, { force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // TC-UT-AF-010: capture 应写 code_annotations + 累计 convention
  it('TC-UT-AF-010: capture should record annotation and increment convention', () => {
    const flywheel = new AlignmentFlywheelImpl(store, [new NodusMdEmitter()]);
    flywheel.capture({
      snapshot: 'const result = service.call();\nreturn result;',
      after: 'const result = service.call();\nif (!result) return null;\nreturn result;',
      symbols_involved: ['sym-1'],
      chunk_id: 'chunk-1',
      brief_field_hits: ['impact_radius'],
      action: 'pass',
      debt_at_review: 3.2,
    });
    const annotations = store.codeAnnotationList();
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.annotation_tags).toContain('add_null_check');

    const conventions = store.conventionList();
    expect(conventions.some(c => c.tag === 'add_null_check')).toBe(true);
  });

  // TC-UT-AF-011: emitConventions 应写 .nodus/conventions.md
  it('TC-UT-AF-011: emitConventions should write conventions.md', () => {
    const flywheel = new AlignmentFlywheelImpl(store, [new NodusMdEmitter()]);
    flywheel.capture({
      snapshot: 'const x = f();',
      after: 'if (!f()) return;\nconst x = f();',
      symbols_involved: ['sym-2'],
      chunk_id: null, brief_field_hits: [], action: 'dig', debt_at_review: 2.0,
    });
    flywheel.emitConventions(projectRoot);
    const mdPath = join(projectRoot, '.nodus', 'conventions.md');
    expect(existsSync(mdPath)).toBe(true);
    const content = readFileSync(mdPath, 'utf-8');
    expect(content).toContain('add_null_check');
  });

  // TC-UT-AF-012: prune 应删除约定
  it('TC-UT-AF-012: prune should delete convention', () => {
    const flywheel = new AlignmentFlywheelImpl(store, [new NodusMdEmitter()]);
    flywheel.capture({
      snapshot: 'const x = f();', after: 'if (!f()) return;\nconst x = f();',
      symbols_involved: ['sym-3'], chunk_id: null, brief_field_hits: [],
      action: 'pass', debt_at_review: 1.0,
    });
    expect(flywheel.prune('add_null_check')).toBe(true);
    expect(flywheel.listConventions().find(c => c.tag === 'add_null_check')).toBeUndefined();
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

Run: `npx vitest run src/alignment/alignment-flywheel.test.ts`
Expected: 发射器 2 个 PASS，实现 3 个 FAIL（模块不存在）

- [ ] **Step 4: 创建实现文件**

创建 `src/alignment/alignment-flywheel.impl.ts`：

```typescript
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Convention } from '../common/types.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { AlignmentFlywheel, CorrectionCapture } from './alignment-flywheel.js';
import { classifyDiff } from './tag-classifier.js';
import type { ConventionsEmitter } from './conventions-emitter.js';

/**
 * 对齐飞轮实现
 */
export class AlignmentFlywheelImpl implements AlignmentFlywheel {
  constructor(
    private store: KnowledgeStore,
    private emitters: ConventionsEmitter[],
  ) {}

  capture(input: CorrectionCapture): void {
    const tags = classifyDiff(input.snapshot, input.after);

    this.store.codeAnnotationRecord({
      ai_generated_code: input.snapshot,
      human_modified_code: input.after,
      diff: this.computeSimpleDiff(input.snapshot, input.after),
      symbols_involved: JSON.stringify(input.symbols_involved),
      annotation_tags: JSON.stringify(tags),
      chunk_id: input.chunk_id,
      brief_field_hits: JSON.stringify(input.brief_field_hits),
      action: input.action,
      debt_at_review: input.debt_at_review,
      created_at: new Date().toISOString(),
    });

    // 累计约定
    for (const tag of tags) {
      const patternDesc = this.describeTag(tag);
      const symbolExample = input.symbols_involved[0] ?? null;
      this.store.conventionUpsert(tag, patternDesc, symbolExample);
      this.store.conventionIncrement(tag, symbolExample);
    }
  }

  emitConventions(projectRoot: string): void {
    const conventions = this.store.conventionList();
    for (const emitter of this.emitters) {
      try {
        const content = emitter.render(conventions);
        const fullPath = join(projectRoot, emitter.targetPath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, 'utf-8');
      } catch (err) {
        // 降级：仅更新本地表，不写文件
        console.error(`[AlignmentFlywheel] emit to ${emitter.targetPath} failed:`, err);
      }
    }
  }

  listConventions(): Convention[] {
    return this.store.conventionList();
  }

  prune(tag: string): boolean {
    return this.store.conventionDelete(tag);
  }

  private computeSimpleDiff(before: string, after: string): string {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    let diff = '';
    for (const line of beforeLines) diff += `- ${line}\n`;
    for (const line of afterLines) diff += `+ ${line}\n`;
    return diff;
  }

  private describeTag(tag: string): string {
    const descriptions: Record<string, string> = {
      add_null_check: '调用外部服务后未判空',
      add_error_handling: '缺少错误处理',
      add_type: '函数参数未标注类型',
      rename_symbol: '命名不规范',
      extract_function: '函数过大需拆分',
      remove_debug: '残留调试代码',
      simplify: '逻辑冗余需简化',
      revert: '变更被回滚',
    };
    return descriptions[tag] ?? tag;
  }
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run src/alignment/alignment-flywheel.test.ts`
Expected: 全部 PASS（发射器 2 + 实现 3 = 5 个测试）

- [ ] **Step 6: 提交**

```bash
git add src/alignment/alignment-flywheel.ts src/alignment/alignment-flywheel.impl.ts src/alignment/alignment-flywheel.test.ts
git commit -m "feat(alignment): AlignmentFlywheel 实现 — 修正捕获 + 约定反哺"
```

---

### Task 11: AnnotatedView

**Files:**
- Create: `src/overlay/annotated-view.ts`
- Create: `src/overlay/annotated-view.test.ts`

**Interfaces:**
- Consumes: `DebtEngine` (`getDebtByFile`, `getTopDebt`), `SemanticChunker` (`brief`),原始文件内容
- Produces: `renderAnnotatedView` 函数 → 带行级标注的终端字符串

- [ ] **Step 1: 写失败测试**

创建 `src/overlay/annotated-view.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { renderAnnotatedView } from './annotated-view.js';
import type { DebtQueryResult } from '../understanding-debt/debt-engine.js';
import type { BriefCard } from '../common/types.js';

describe('renderAnnotatedView', () => {
  // TC-UT-AV-001: 应在改过的符号行旁标注债值
  it('TC-UT-AV-001: should annotate lines with debt info', () => {
    const code = 'export function foo() {\n  return 1;\n}\n';
    const debts: DebtQueryResult[] = [
      { symbol_id: 'a.ts:foo', name: 'foo', file_path: 'a.ts', debt: 3.5, level: 'red', examined: false, confirmed: false },
    ];
    const output = renderAnnotatedView('a.ts', code, debts, []);
    expect(output).toContain('foo');
    expect(output).toContain('3.5');
    expect(output).toContain('红'); // 红色标记
  });

  // TC-UT-AV-002: 应在旁挂简报摘要
  it('TC-UT-AV-002: should attach brief summary', () => {
    const code = 'export function bar() {\n  return 2;\n}\n';
    const debts: DebtQueryResult[] = [
      { symbol_id: 'b.ts:bar', name: 'bar', file_path: 'b.ts', debt: 2.0, level: 'yellow', examined: false, confirmed: false },
    ];
    const briefs: BriefCard[] = [{
      chunk_id: 'chunk-1', title: 'bar @ src', symbols: [{ name: 'bar', complexity: 3 }],
      impact_radius: 4, risk_level: 'medium', complexity_hotspots: ['bar'],
      test_coverage: false, known_issues: [], suggested_inspect_point: { file: 'b.ts', line: 1 },
    }];
    const output = renderAnnotatedView('b.ts', code, debts, briefs);
    expect(output).toContain('bar');
    expect(output).toContain('chunk-1');
  });

  // TC-UT-AV-003: 无债值时返回纯代码视图
  it('TC-UT-AV-003: should return plain code when no debt', () => {
    const code = 'const x = 1;\n';
    const output = renderAnnotatedView('c.ts', code, [], []);
    expect(output).toContain('const x = 1;');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run src/overlay/annotated-view.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建实现文件**

创建 `src/overlay/annotated-view.ts`：

```typescript
import type { BriefCard } from '../common/types.js';
import type { DebtQueryResult } from '../understanding-debt/debt-engine.js';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/**
 * 渲染带标注的代码视图 — P1 终端近似版
 */
export function renderAnnotatedView(
  filePath: string,
  code: string,
  debts: DebtQueryResult[],
  briefs: BriefCard[],
): string {
  const lines = code.split('\n');
  const debtByLine = new Map<number, DebtQueryResult>();
  for (const d of debts) {
    // 简化：按符号名匹配行
    const lineIdx = lines.findIndex(l => l.includes(d.name));
    if (lineIdx >= 0) debtByLine.set(lineIdx + 1, d);
  }

  const levelLabel: Record<string, string> = { green: '绿', yellow: '黄', red: '红' };
  const levelColor: Record<string, string> = { green: GREEN, yellow: YELLOW, red: RED };

  let out = `${BOLD}${filePath}${RESET}\n`;
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const debt = debtByLine.get(lineNum);
    const prefix = `${DIM}${String(lineNum).padStart(4)}${RESET}  `;
    out += `${prefix}${lines[i]}\n`;
    if (debt) {
      const color = levelColor[debt.level] ?? RESET;
      out += `     ${color}└─[AI 改过] 债值 ${debt.debt.toFixed(1)} ●${levelLabel[debt.level]}${RESET}`;
      const brief = briefs.find(b => b.symbols.some(s => s.name === debt.name));
      if (brief) {
        out += ` ${DIM}│ ${brief.title} │ 影响半径 ${brief.impact_radius} │ 风险 ${brief.risk_level}${RESET}`;
      }
      if (!debt.examined && !debt.confirmed) {
        out += ` ${YELLOW}│ 建议从此处开始审查${RESET}`;
      }
      out += '\n';
    }
  }

  // 尾部附简报卡列表
  if (briefs.length > 0) {
    out += `\n${BOLD}── 简报卡 ──${RESET}\n`;
    for (const b of briefs) {
      out += `${CYAN}[${b.chunk_id}]${RESET} ${b.title} · 影响 ${b.impact_radius} · 风险 ${b.risk_level}`;
      if (b.suggested_inspect_point) {
        out += ` ${DIM}→ 建议抽检 ${b.suggested_inspect_point.file}:${b.suggested_inspect_point.line}${RESET}`;
      }
      out += '\n';
    }
  }

  return out;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run src/overlay/annotated-view.test.ts`
Expected: 3 个测试全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/overlay/annotated-view.ts src/overlay/annotated-view.test.ts
git commit -m "feat(overlay): AnnotatedView — 终端带标注代码视图"
```

---

### Task 12: Intent 接入 + QueryResult 扩展 + Shell 接线

**Files:**
- Modify: `src/code-intel/code-intelligence.ts` (QueryResult 联合)
- Modify: `src/intent/intent-engine.impl.ts` (5 条 pattern)
- Modify: `src/ui/terminal-renderer.ts` (render switch)
- Modify: `src/shell/nodus-shell.ts` (接线 + 路由)
- Modify: `src/main.ts` (/confirm + /prune 命令)

**Interfaces:**
- Consumes: 全部前序 task 产物
- Produces: 端到端可用的 REPL 体验

- [ ] **Step 1: 扩展 QueryResult 联合类型**

在 `src/code-intel/code-intelligence.ts` 的 `QueryResult` 类型联合中，在最后一个 `| { kind: 'review_report'; report: ReviewReport }` 之后追加：

```typescript
  | { kind: 'debt_heatmap'; entries: import('../understanding-debt/debt-engine.js').DebtQueryResult[] }
  | { kind: 'annotated_view'; filePath: string; content: string; output: string }
  | { kind: 'brief_card'; brief: import('../common/types.js').BriefCard }
  | { kind: 'conventions_list'; conventions: import('../common/types.js').Convention[] }
  | { kind: 'confirmation'; message: string };
```

- [ ] **Step 2: 在 intent-engine.impl.ts 的 matchIntent rules 数组追加 5 条规则**

在 `src/intent/intent-engine.impl.ts` 的 `matchIntent` 方法内 `rules` 数组中，在最后一条规则之后追加：

```typescript
      {
        patterns: [
          /(?:ai\s+)?(?:最近|recent|latest).{0,6}(?:改了?什么|改了?哪儿|变更|changes?|modified)/i,
          /最近.{0,4}(?:什么|哪些).{0,4}改/i,
        ],
        intentType: 'recent_changes',
        extractEntities: () => ({}),
      },
      {
        patterns: [
          /(?:查看|打开|看看|view|show|open)\s+(.+?\.(?:ts|tsx|js|jsx|py))/i,
          /(.+?\.(?:ts|tsx|js|jsx|py))\s*(?:的)?(?:代码|文件|视图|带标注)/i,
        ],
        intentType: 'view_annotated',
        extractEntities: (match, _text, _ctx) => ({
          filePath: match[1] ?? undefined,
        }),
      },
      {
        patterns: [
          /(?:块\s*\d+|chunk\s*\d+).{0,4}(?:的)?(?:简报|brief|改了?什么|详情)/i,
          /(?:这|那)块.{0,4}(?:简报|改了?什么|详情)/i,
        ],
        intentType: 'chunk_brief',
        extractEntities: (match, _text, _ctx) => {
          const numMatch = match[0].match(/\d+/);
          return { subType: numMatch ? `chunk-${parseInt(numMatch[0], 10) - 1}` : undefined };
        },
      },
      {
        patterns: [
          /(?:这|那)?块.{0,2}(?:过了|ok|pass|确认|confirm)/i,
          /\/confirm\s+(.+)/i,
          /确认\s+(.+).{0,2}(?:过了|审完|ok)/i,
        ],
        intentType: 'confirm_reviewed',
        extractEntities: (match, _text, ctx) => ({
          symbolName: match[1] ? match[1].trim() : ctx.cursor_symbol ?? undefined,
        }),
      },
      {
        patterns: [
          /(?:\/prune|删掉?|移除|remove)\s+(.+?)(?:约定|convention)?/i,
          /prune\s+(.+)/i,
        ],
        intentType: 'prune_conventions',
        extractEntities: (match, _text, _ctx) => ({
          symbolName: match[1]?.trim() ?? undefined,
        }),
      },
```

- [ ] **Step 3: 在 terminal-renderer.ts 的 render switch 追加分支**

在 `src/ui/terminal-renderer.ts` 的 `render` 方法 `switch` 块中，在 `default` 之前追加：

```typescript
    case 'debt_heatmap':       return this.renderDebtHeatmap(result.entries);
    case 'annotated_view':     return result.output;
    case 'brief_card':         return this.renderBriefCard(result.brief);
    case 'conventions_list':   return this.renderConventionsList(result.conventions);
    case 'confirmation':       return `${GREEN}${result.message}${RESET}`;
```

并在 `TerminalRenderer` 类中追加这两个私有方法（在 `renderReviewReport` 之后）：

```typescript
  private renderDebtHeatmap(entries: DebtQueryResult[]): string {
    if (entries.length === 0) return `${DIM}当前无理解债。${RESET}\n`;
    let out = `${BOLD}理解债热力图${RESET}\n`;
    for (const e of entries) {
      const color = e.level === 'red' ? RED : e.level === 'yellow' ? YELLOW : GREEN;
      const tag = e.confirmed ? `${GREEN}✓已审${RESET}` : e.examined ? `${YELLOW}○已看${RESET}` : `${RED}●未审${RESET}`;
      out += `  ${color}●${RESET} ${e.name} ${DIM}(${e.file_path})${RESET} 债值 ${e.debt.toFixed(1)} ${tag}\n`;
    }
    return out;
  }

  private renderBriefCard(brief: BriefCard): string {
    let out = `${BOLD}简报卡: ${brief.title}${RESET}\n`;
    out += `  影响半径: ${brief.impact_radius}  风险: ${brief.risk_level}  测试覆盖: ${brief.test_coverage ? '是' : '否'}\n`;
    out += `  改动符号: ${brief.symbols.map(s => `${s.name}(复杂度${s.complexity})`).join(', ')}\n`;
    if (brief.complexity_hotspots.length > 0) {
      out += `  复杂度热点: ${brief.complexity_hotspots.join(', ')}\n`;
    }
    if (brief.known_issues.length > 0) {
      out += `  已知隐患: ${brief.known_issues.join('; ')}\n`;
    }
    if (brief.suggested_inspect_point) {
      out += `  ${YELLOW}建议抽检: ${brief.suggested_inspect_point.file}:${brief.suggested_inspect_point.line}${RESET}\n`;
    }
    return out;
  }

  private renderConventionsList(conventions: Convention[]): string {
    if (conventions.length === 0) return `${DIM}暂无约定。${RESET}\n`;
    let out = `${BOLD}项目约定${RESET}\n`;
    for (const c of conventions) {
      out += `  ${CYAN}${c.tag}${RESET}: ${c.pattern_desc} (${c.occurrences} 次)\n`;
    }
    return out;
  }
```

同时在 `terminal-renderer.ts` 顶部追加导入：

```typescript
import type { BriefCard, Convention } from '../common/types.js';
import type { DebtQueryResult } from '../understanding-debt/debt-engine.js';
```

- [ ] **Step 4: 在 nodus-shell.ts 接线新模块 + 路由新意图**

在 `src/shell/nodus-shell.ts` 顶部追加导入：

```typescript
import { DefaultChangeSensor } from '../change-sensor/change-sensor.impl.js';
import { DebtEngineImpl } from '../understanding-debt/debt-engine.impl.js';
import { SemanticChunkerImpl } from '../semantic-chunk/semantic-chunker.impl.js';
import { AlignmentFlywheelImpl } from '../alignment/alignment-flywheel.impl.js';
import { NodusMdEmitter } from '../alignment/emitters/nodus-md-emitter.js';
import { renderAnnotatedView } from '../overlay/annotated-view.js';
```

在 `NodusShell` 类的 readonly 字段区追加：

```typescript
  readonly changeSensor: DefaultChangeSensor;
  readonly debtEngine: DebtEngineImpl;
  readonly chunker: SemanticChunkerImpl;
  readonly flywheel: AlignmentFlywheelImpl;
```

在构造器 Phase 4 之后追加 Phase 5：

```typescript
    // Phase 5: 理解层
    this.changeSensor = new DefaultChangeSensor(this.gitIntel);
    this.debtEngine = new DebtEngineImpl(this.store);
    this.chunker = new SemanticChunkerImpl();
    this.flywheel = new AlignmentFlywheelImpl(this.store, [new NodusMdEmitter()]);
    this.modules.set('change_sensor', this.changeSensor);
    this.modules.set('debt_engine', this.debtEngine);
    this.modules.set('chunker', this.chunker);
    this.modules.set('flywheel', this.flywheel);
```

在 `handleQueryFormatted` 方法中，`switch_project` / `list_projects` 拦截之后、`this.codeIntel.query(intent)` 之前，追加新意图路由：

```typescript
    // 理解层意图拦截
    if (intent.intentType === 'recent_changes') {
      const projectRoot = this.config.projectPaths[0] ?? '.';
      const batch = await this.changeSensor.detect(projectRoot);
      if (!batch) {
        return `${DIM}没有检测到未提交的变更。${RESET}\n`;
      }
      await this.debtEngine.recompute(batch);
      const chunks = this.chunker.chunk(batch);
      const briefs = chunks.map(c => this.chunker.brief(c, batch));
      const topDebts = this.debtEngine.getTopDebt(20);
      let out = this.uiRenderer.render({ kind: 'debt_heatmap', entries: topDebts });
      out += `\n${DIM}── ${chunks.length} 个语义块 ──${RESET}\n`;
      for (const b of briefs) {
        out += `  ${CYAN}[${b.chunk_id}]${RESET} ${b.title} · 风险 ${b.risk_level}`;
        if (b.suggested_inspect_point) {
          out += ` ${DIM}→ ${b.suggested_inspect_point.file}:${b.suggested_inspect_point.line}${RESET}`;
        }
        out += '\n';
      }
      this.queryCache.set(cacheKey, out);
      return out;
    }

    if (intent.intentType === 'view_annotated') {
      const filePath = intent.entities.filePath ?? '';
      const projectRoot = this.config.projectPaths[0] ?? '.';
      const fullPath = resolve(projectRoot, filePath);
      let code = '';
      try { code = readFileSync(fullPath, 'utf-8'); } catch {
        return `${RED}无法读取文件: ${filePath}${RESET}\n`;
      }
      const debts = this.debtEngine.getDebtByFile(filePath);
      const output = renderAnnotatedView(filePath, code, debts, []);
      const result = { kind: 'annotated_view' as const, filePath, content: code, output };
      return this.uiRenderer.render(result);
    }

    if (intent.intentType === 'chunk_brief') {
      const projectRoot = this.config.projectPaths[0] ?? '.';
      const batch = await this.changeSensor.detect(projectRoot);
      if (!batch) return `${DIM}无变更。${RESET}\n`;
      const chunks = this.chunker.chunk(batch);
      const idx = intent.entities.subType
        ? parseInt(intent.entities.subType.replace('chunk-', ''), 10)
        : 0;
      const chunk = chunks[idx] ?? chunks[0];
      if (!chunk) return `${DIM}无语义块。${RESET}\n`;
      const brief = this.chunker.brief(chunk, batch);
      return this.uiRenderer.render({ kind: 'brief_card', brief });
    }

    if (intent.intentType === 'confirm_reviewed') {
      const symbolName = intent.entities.symbolName ?? '';
      if (!symbolName) return `${YELLOW}请指定要确认的符号名。${RESET}\n`;
      this.debtEngine.confirmReviewed(symbolName);
      return this.uiRenderer.render({ kind: 'confirmation', message: `已确认审查: ${symbolName}（债值清零）` });
    }

    if (intent.intentType === 'prune_conventions') {
      const tag = intent.entities.symbolName ?? '';
      if (!tag) {
        return this.uiRenderer.render({ kind: 'conventions_list', conventions: this.flywheel.listConventions() });
      }
      const deleted = this.flywheel.prune(tag);
      return this.uiRenderer.render({ kind: 'confirmation', message: deleted ? `已删除约定: ${tag}` : `未找到约定: ${tag}` });
    }
```

同时确保顶部有 `resolve, readFileSync` 导入：

```typescript
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
```

- [ ] **Step 5: 在 main.ts 追加 /confirm 和 /prune 命令**

在 `src/main.ts` 的 REPL 循环中，`/sync` 处理之后、`/quit` 处理之前追加：

```typescript
  // /confirm <symbol> 命令
  if (input.startsWith('/confirm ')) {
    const symbol = input.slice('/confirm '.length).trim();
    if (symbol) {
      const output = await shell.handleQueryFormatted(`/confirm ${symbol}`);
      console.log(output);
    }
    continue;
  }

  // /prune [tag] 命令
  if (input === '/prune' || input.startsWith('/prune ')) {
    const tag = input.startsWith('/prune ') ? input.slice('/prune '.length).trim() : '';
    const output = await shell.handleQueryFormatted(tag ? `/prune ${tag}` : '列出约定');
    console.log(output);
    continue;
  }
```

- [ ] **Step 6: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误（如有，修正导入和类型）

- [ ] **Step 7: 运行全部测试确认无回归**

Run: `npx vitest run`
Expected: 全部 PASS（原有 422 + 新增 ~30）

- [ ] **Step 8: 提交**

```bash
git add src/code-intel/code-intelligence.ts src/intent/intent-engine.impl.ts src/ui/terminal-renderer.ts src/shell/nodus-shell.ts src/main.ts
git commit -m "feat(understanding-layer): 接入 REPL — intent + renderer + shell + 命令"
```

---

### Task 13: 端到端集成测试

**Files:**
- Create: `src/understanding-debt/alignment-integration.test.ts`

**Interfaces:**
- Consumes: 全部前序 task 产物
- Produces: 验证 spec 8.1 端到端旅程

- [ ] **Step 1: 写集成测试**

创建 `src/understanding-debt/alignment-integration.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../store/migrations.js';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { GitIntelligenceImpl } from '../git-intel/git-intelligence.impl.js';
import { DefaultChangeSensor } from '../change-sensor/change-sensor.impl.js';
import { DebtEngineImpl } from '../understanding-debt/debt-engine.impl.js';
import { SemanticChunkerImpl } from '../semantic-chunk/semantic-chunker.impl.js';
import { AlignmentFlywheelImpl } from '../alignment/alignment-flywheel.impl.js';
import { NodusMdEmitter } from '../alignment/emitters/nodus-md-emitter.js';
import { renderAnnotatedView } from '../overlay/annotated-view.js';

describe('理解层端到端集成测试', () => {
  let projectRoot: string;
  let dbPath: string;
  let store: SqliteKnowledgeStore;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'nodus-e2e-'));
    execSync('git init && git config user.email t@t.com && git config user.name t', { cwd: projectRoot, stdio: 'pipe' });
    writeFileSync(join(projectRoot, 'payment.ts'), 'export function charge(amount: number) {\n  return amount;\n}\n');
    execSync('git add -A && git commit -m init', { cwd: projectRoot, stdio: 'pipe' });

    dbPath = join(tmpdir(), `nodus-e2e-${Date.now()}.db`);
    const db = new Database(dbPath);
    new MigrationRunner(db).run();
    db.close();
    store = new SqliteKnowledgeStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dbPath, { force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // TC-IT-E2E-001: 端到端旅程 — spec 8.1
  it('TC-IT-E2E-001: should run full alignment pipeline', async () => {
    // 1. 模拟 AI 改文件
    writeFileSync(join(projectRoot, 'payment.ts'),
      'export function charge(amount: number) {\n  const result = service.pay(amount);\n  return result;\n}\n');

    // 2. ChangeSensor 检测
    const sensor = new DefaultChangeSensor(new GitIntelligenceImpl());
    const batch = await sensor.detect(projectRoot);
    expect(batch).not.toBeNull();
    expect(batch!.files).toContain('payment.ts');

    // 3. DebtEngine 重算
    const debtEngine = new DebtEngineImpl(store);
    await debtEngine.recompute(batch!);
    const topDebts = debtEngine.getTopDebt(10);
    expect(topDebts.length).toBeGreaterThan(0);
    const redDebts = topDebts.filter(d => d.level === 'red' || d.level === 'yellow');
    expect(redDebts.length).toBeGreaterThan(0);

    // 4. SemanticChunker 聚类 + 简报
    const chunker = new SemanticChunkerImpl();
    const chunks = chunker.chunk(batch!);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const briefs = chunks.map(c => chunker.brief(c, batch!));
    expect(briefs[0]!.title).toBeDefined();

    // 5. 渲染 AnnotatedView
    const debts = debtEngine.getDebtByFile('payment.ts');
    const view = renderAnnotatedView('payment.ts', batch!.snapshot['payment.ts']!, debts, briefs);
    expect(view).toContain('charge');

    // 6. 确认审查 → 债值清零
    const symbolId = topDebts[0]!.symbol_id;
    debtEngine.confirmReviewed(symbolId);
    const afterConfirm = debtEngine.getTopDebt(10).find(d => d.symbol_id === symbolId);
    expect(afterConfirm!.debt).toBe(0);
    expect(afterConfirm!.confirmed).toBe(true);

    // 7. 修正捕获 → conventions 入库
    const flywheel = new AlignmentFlywheelImpl(store, [new NodusMdEmitter()]);
    flywheel.capture({
      snapshot: 'const result = service.pay(amount);\n  return result;',
      after: 'const result = service.pay(amount);\n  if (!result) return null;\n  return result;',
      symbols_involved: ['payment.ts:charge'],
      chunk_id: chunks[0]!.id,
      brief_field_hits: ['impact_radius', 'complexity_hotspots'],
      action: 'pass',
      debt_at_review: topDebts[0]!.debt,
    });

    const annotations = store.codeAnnotationList();
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.annotation_tags).toContain('add_null_check');

    const conventions = store.conventionList();
    expect(conventions.some(c => c.tag === 'add_null_check')).toBe(true);

    // 8. 发射 conventions.md
    flywheel.emitConventions(projectRoot);
    const mdPath = join(projectRoot, '.nodus', 'conventions.md');
    expect(existsSync(mdPath)).toBe(true);
    const mdContent = readFileSync(mdPath, 'utf-8');
    expect(mdContent).toContain('add_null_check');
    expect(mdContent).toContain('charge');
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `npx vitest run src/understanding-debt/alignment-integration.test.ts`
Expected: PASS

- [ ] **Step 3: 运行全部测试确认无回归**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add src/understanding-debt/alignment-integration.test.ts
git commit -m "test(integration): 理解层端到端集成测试 — spec 8.1 旅程"
```

---

## Self-Review

### 1. Spec 覆盖检查

| Spec 章节 | 覆盖任务 |
|-----------|---------|
| §3 整体架构 | Task 1-13（全部模块） |
| §4 DebtEngine | Task 4(公式) + Task 6(引擎) |
| §4.3 debt_entries 表 | Task 2(迁移) + Task 3(CRUD) |
| §4.4 触发时机 | Task 6(recompute) + Task 12(REPL 确认) |
| §4.5 飞轮自校准 | **缺口**：P1 暂未实现权重重拟合，spec 标注 N=50 才触发。属 v2 延展，P1 先跑通闭环 |
| §5 SemanticChunker | Task 7 |
| §5.2 聚类算法 | Task 7（P1 用文件目录聚类代替调用图连通分量，因 CodeIntelligence.query 是 async 且需要已索引项目；标注为简化版） |
| §6 AlignmentFlywheel | Task 8(tag) + Task 9(emitter) + Task 10(impl) |
| §6.2 code_annotations 表 | Task 2 + Task 3 |
| §6.3 tag 规则库 | Task 8 |
| §6.4 双向反哺 | Task 10(capture→convention) + Task 12(emitConventions)。DebtEngine 权重重拟合同 §4.5 延后 |
| §7.1 AnnotatedView | Task 11 |
| §8.1 端到端旅程 | Task 13 |
| §9.4 intent 接入 | Task 12 |
| ConventionsEmitter CursorRules/AgentsMd | **缺口**：P1 只实现 NodusMdEmitter。spec 说"检测到时"才发射，P1 先跑通默认路径 |

### 2. 已知简化（可在 v2 迭代）

- SemanticChunker 聚类用文件目录代替调用图连通分量（P1 不依赖 async CodeIntelligence 已索引前提）
- DebtEngine difficulty 用 diff 行数启发式代替 complexityScores + ImpactAnalysis（P1 避免跨 async 依赖）
- DebtEngine 飞轮自校准权重重拟合延后到 v2（需攒够 50 条数据）
- ConventionsEmitter 只实现 NodusMd，CursorRules/AgentsMd 延后

### 3. 类型一致性

- `DebtEntry` / `CodeAnnotationRecord` / `Convention` 在 types.ts 定义，Store / DebtEngine / Flywheel 全部引用同一类型 ✓
- `ChangeBatch` / `ChangedSymbol` 在 types.ts 定义，ChangeSensor / DebtEngine / SemanticChunker 全部引用 ✓
- `SemanticChunk` / `BriefCard` 在 types.ts 定义，Chunker / AnnotatedView / Renderer 全部引用 ✓
- `DebtQueryResult` 在 debt-engine.ts 定义，DebtEngine / AnnotatedView / Renderer 全部引用 ✓
- `CorrectionCapture` 在 alignment-flywheel.ts 定义，Flywheel 接口/实现一致 ✓
- `IntentType` 5 个新值在 types.ts 定义，intent-engine / shell 路由一致 ✓
- `QueryResult` 5 个新变种的字段名与 Renderer / Shell 中使用一致 ✓
