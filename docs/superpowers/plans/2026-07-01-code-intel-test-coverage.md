# R1.2 CodeIntelligence 测试补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 `CodeIntelligence` 与 `TypeScriptParser` 的单元/集成测试，覆盖尚未测试的核心方法（`callGraph`、`query` 路由、增量索引）和符号类型（interface/type/enum）。

**Architecture:** 基于现有 Vitest 测试框架，在 `src/code-intel/code-intelligence.test.ts` 和 `src/code-intel/code-intelligence.integration.test.ts` 中新增测试用例；对 parser 的符号提取能力在 `src/code-intel/code-intelligence.test.ts` 中补充。所有测试使用真实 `SqliteKnowledgeStore`（`:memory:`）和真实 parser，不 mock。

**Tech Stack:** Node.js 20+, TypeScript, Vitest, better-sqlite3, tree-sitter

## Global Constraints

- ESM 模块系统，`package.json` 中 `"type": "module"`
- TypeScript 严格模式，`verbatimModuleSyntax: true`
- 类型导入必须写 `import type { ... }`
- 测试使用真实实现，不 mock parser/store（除 `CodeAnalytics` 已使用的 helper 外）
- 新增测试必须稳定通过（不依赖随机临时目录名称）
- 修改后 `npm test` 仍须全绿

---

## File Structure

| 文件 | 责任 |
|------|------|
| `src/code-intel/code-intelligence.test.ts` | 新增 TypeScriptParser 符号类型测试、query 路由测试 |
| `src/code-intel/code-intelligence.integration.test.ts` | 新增 callGraph、indexFile 增量更新、多 intent query 路由测试 |

---

### Task 1: TypeScriptParser 符号类型补充测试

**Files:**
- Modify: `src/code-intel/code-intelligence.test.ts`
- Test: `npm test -- src/code-intel/code-intelligence.test.ts`

**Interfaces:**
- Consumes: `TypeScriptParser.parseSymbols(source, filePath)`
- Produces: 新增 assertions 验证 interface / type alias / enum / namespace 符号提取

- [ ] **Step 1: 编写 interface 符号提取测试**

在 `describe('TypeScriptParser', () => { ... })` 内新增：

```typescript
// TC-UT-CI-022: 提取 interface 符号
it('TC-UT-CI-022: should extract interface symbol', () => {
  const source = `
export interface RefundResult {
  status: string;
  amount: number;
}
`;
  const symbols = parser.parseSymbols(source, 'src/types.ts');
  const iface = symbols.find(s => s.name === 'RefundResult');
  expect(iface).toBeDefined();
  expect(iface!.kind).toBe('interface');
  expect(iface!.is_exported).toBe(true);
});
```

- [ ] **Step 2: 编写 type alias 符号提取测试**

```typescript
// TC-UT-CI-023: 提取 type alias 符号
it('TC-UT-CI-023: should extract type alias symbol', () => {
  const source = `
export type OrderId = string;
`;
  const symbols = parser.parseSymbols(source, 'src/types.ts');
  const typeAlias = symbols.find(s => s.name === 'OrderId');
  expect(typeAlias).toBeDefined();
  expect(typeAlias!.kind).toBe('type');
  expect(typeAlias!.is_exported).toBe(true);
});
```

- [ ] **Step 3: 编写 enum 符号提取测试**

```typescript
// TC-UT-CI-024: 提取 enum 符号
it('TC-UT-CI-024: should extract enum symbol', () => {
  const source = `
export enum RefundStatus {
  Pending = 'pending',
  Completed = 'completed',
}
`;
  const symbols = parser.parseSymbols(source, 'src/types.ts');
  const enumSym = symbols.find(s => s.name === 'RefundStatus');
  expect(enumSym).toBeDefined();
  expect(enumSym!.kind).toBe('enum');
  expect(enumSym!.is_exported).toBe(true);
});
```

- [ ] **Step 4: 运行新增测试**

Run:
```bash
npm test -- src/code-intel/code-intelligence.test.ts
```

Expected: 原有测试 + 新增测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/code-intel/code-intelligence.test.ts
git commit -m "test(code-intel): add parser tests for interface, type alias and enum"
```

---

### Task 2: CodeIntelligence callGraph 集成测试

**Files:**
- Modify: `src/code-intel/code-intelligence.integration.test.ts`
- Test: `npm test -- src/code-intel/code-intelligence.integration.test.ts`

**Interfaces:**
- Consumes: `CodeIntelligence.callGraph(symbolId, direction, maxDepth)`
- Produces: 验证调用图节点/边包含预期符号

- [ ] **Step 1: 在 integration test 文件末尾新增 describe**

```typescript
// TC-IT-CI-KS-012: callGraph 调用图构建
describe('CodeIntelligence CallGraph', () => {
  const tmpDir = join(tmpdir(), `nodus-callgraph-test-${Date.now()}`);
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeAll(async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'chain.ts'), `
export async function levelA() {
  return levelB();
}

async function levelB() {
  return levelC();
}

async function levelC() {
  return 'done';
}
`);
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'callgraph-test' }));

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-IT-CI-KS-012: should build call graph with callers and callees', async () => {
    const syms = await ci.findSymbol('levelA');
    expect(syms.length).toBeGreaterThanOrEqual(1);
    const levelA = syms.find(s => s.name === 'levelA')!;

    const graph = await ci.callGraph(levelA.id, 'both', 3);
    expect(graph).not.toBeNull();

    const nodeNames = new Set(graph!.nodes.map(n => n.symbol_name));
    expect(nodeNames).toContain('levelA');
    expect(nodeNames).toContain('levelB');
    expect(nodeNames).toContain('levelC');

    const edges = graph!.edges;
    expect(edges.some(e => e.from === levelA.id)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行新增测试**

Run:
```bash
npm test -- src/code-intel/code-intelligence.integration.test.ts
```

Expected: 原有测试 + 新增测试全部通过。

- [ ] **Step 3: Commit**

```bash
git add src/code-intel/code-intelligence.integration.test.ts
git commit -m "test(code-intel): add callGraph integration test"
```

---

### Task 3: CodeIntelligence query 路由集成测试

**Files:**
- Modify: `src/code-intel/code-intelligence.integration.test.ts`
- Test: `npm test -- src/code-intel/code-intelligence.integration.test.ts`

**Interfaces:**
- Consumes: `CodeIntelligence.query(intent)`
- Produces: 验证不同 `intentType` 返回正确的 `QueryResult` 变体

- [ ] **Step 1: 在已有的 `CodeIntelligence Integration` describe 内，于 `should route query intents correctly` 之后新增测试**

替换/扩展原有 `should route query intents correctly` 为多个独立 it 块，或在它后面追加：

```typescript
it('TC-IT-CI-KS-013: should route find_references intent', async () => {
  const result = await ci.query({
    intentType: 'find_references',
    confidence: 0.95,
    rawText: 'who calls refundOrder',
    entities: { symbolName: 'refundOrder' },
  });
  expect(result.kind).toBe('reference_list');
});

it('TC-IT-CI-KS-014: should route call_graph intent', async () => {
  const result = await ci.query({
    intentType: 'call_graph',
    confidence: 0.95,
    rawText: 'call graph of refundOrder',
    entities: { symbolName: 'refundOrder' },
  });
  expect(result.kind).toBe('call_graph');
});

it('TC-IT-CI-KS-015: should route impact_analysis intent', async () => {
  const result = await ci.query({
    intentType: 'impact_analysis',
    confidence: 0.95,
    rawText: 'impact of refundOrder',
    entities: { symbolName: 'refundOrder' },
  });
  expect(result.kind).toBe('impact_report');
});

it('TC-IT-CI-KS-016: should route symbol_overview intent', async () => {
  const result = await ci.query({
    intentType: 'symbol_overview',
    confidence: 0.95,
    rawText: 'symbols in index.ts',
    entities: { filePath: join(FIXTURE_DIR, 'src', 'index.ts') },
  });
  expect(result.kind).toBe('symbol_overview');
});

it('TC-IT-CI-KS-017: should route stats intent', async () => {
  const result = await ci.query({
    intentType: 'stats',
    confidence: 0.95,
    rawText: 'project stats',
    entities: {},
  });
  expect(result.kind).toBe('stats_report');
});
```

- [ ] **Step 2: 运行新增测试**

Run:
```bash
npm test -- src/code-intel/code-intelligence.integration.test.ts
```

Expected: 全部通过。

- [ ] **Step 3: Commit**

```bash
git add src/code-intel/code-intelligence.integration.test.ts
git commit -m "test(code-intel): add query routing integration tests"
```

---

### Task 4: indexFile 增量更新集成测试

**Files:**
- Modify: `src/code-intel/code-intelligence.integration.test.ts`
- Test: `npm test -- src/code-intel/code-intel.integration.test.ts`（注意：Vitest 模式匹配 `*.integration.test.ts`）

**Interfaces:**
- Consumes: `CodeIntelligence.indexFile(filePath)`
- Produces: 验证文件内容变更后重新索引，未变更文件跳过

- [ ] **Step 1: 在 integration test 文件末尾新增 describe**

```typescript
// TC-IT-CI-KS-018 ~ TC-IT-CI-KS-019: indexFile 增量更新
describe('CodeIntelligence indexFile incremental update', () => {
  const tmpDir = join(tmpdir(), `nodus-indexfile-test-${Date.now()}`);
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeAll(async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'a.ts'), `export function helperA(): string { return 'a'; }`);
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'indexfile-test' }));

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-IT-CI-KS-018: should skip unchanged file in indexFile', async () => {
    const result = await ci.indexFile(join(tmpDir, 'src', 'a.ts'));
    expect(result.symbolsAdded).toBe(0);
    expect(result.symbolsRemoved).toBe(0);
    expect(result.referencesUpdated).toBe(0);
  });

  it('TC-IT-CI-KS-019: should re-index changed file and update symbols', async () => {
    writeFileSync(join(tmpDir, 'src', 'a.ts'), `
export function helperA(): string { return 'a'; }
export function helperB(): string { return 'b'; }
`);

    const result = await ci.indexFile(join(tmpDir, 'src', 'a.ts'));
    expect(result.symbolsAdded).toBeGreaterThan(0);

    const syms = await ci.symbolsInFile(join(tmpDir, 'src', 'a.ts'));
    const names = syms.map(s => s.name);
    expect(names).toContain('helperA');
    expect(names).toContain('helperB');
  });
});
```

- [ ] **Step 2: 运行新增测试**

Run:
```bash
npm test -- src/code-intel/code-intelligence.integration.test.ts
```

Expected: 全部通过。

- [ ] **Step 3: Commit**

```bash
git add src/code-intel/code-intelligence.integration.test.ts
git commit -m "test(code-intel): add indexFile incremental update tests"
```

---

### Task 5: 更新 README 勾选 R1.2

**Files:**
- Modify: `readme.md`
- Test: 无需测试，文档变更

- [ ] **Step 1: 勾选 R1.2**

在 `readme.md` 中找到：
```markdown
- [ ] R1.2 CodeIntelligence 单元测试与集成测试补全
```

替换为：
```markdown
- [x] R1.2 CodeIntelligence 单元测试与集成测试补全
```

- [ ] **Step 2: 运行完整测试套件确认无回归**

Run:
```bash
npm test
```

Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add readme.md
git commit -m "docs(readme): mark R1.2 as completed"
```

---

## Self-Review

**1. Spec coverage:**
- R1.2 要求"把当前为空的 code-intel.test.ts / integration.test.ts 写满，覆盖 TS/JS/Python 解析、引用解析、调用图构建" → Task 1 补充 parser 符号类型，Task 2 补充 callGraph，Task 3 补充 query 路由，Task 4 补充增量索引。
- 跨文件引用解析、impactAnalysis、changeHistory 在现有 integration test 中已有覆盖，无需重复。

**2. Placeholder scan:**
- 无 TBD/TODO/fill in details。
- 每个步骤包含完整代码和命令。

**3. Type consistency:**
- 测试沿用现有 `vitest` 类型与项目 `Symbol/Reference` 类型。
- `intentType` 值与 `src/common/types.ts` 中定义一致。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-01-code-intel-test-coverage.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
