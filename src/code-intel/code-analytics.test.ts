// ============================================================
// CodeAnalytics 单元测试 — TC-UT-CA-001 ~ TC-UT-CA-012
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { DefaultCodeAnalytics } from './code-analytics.impl.js';
import type { Symbol, Reference, SymbolKind } from '../common/types.js';
import type { SymbolListFilter } from './code-analytics.js';

function makeSymbol(overrides: Partial<Symbol> = {}): Symbol {
  const name = overrides.name ?? 'test';
  return {
    id: `sym_${name}`,
    name,
    kind: 'function',
    language: 'typescript',
    location: {
      file_path: overrides.location?.file_path ?? 'src/a.ts',
      line_start: 1,
      line_end: 2,
      col_start: 0,
      col_end: 1,
    },
    is_exported: true,
    ...overrides,
  };
}

function makeRef(overrides: Partial<Reference> = {}): Reference {
  return {
    id: `ref_${overrides.source_symbol_id ?? 's'}_${overrides.target_symbol_id ?? 't'}_${overrides.kind ?? 'call'}`,
    source_symbol_id: 'sym_a',
    target_symbol_id: 'sym_b',
    location: { file_path: 'src/a.ts', line_start: 10, line_end: 10, col_start: 0, col_end: 1 },
    kind: 'call',
    ...overrides,
  };
}

describe('CodeAnalytics', () => {
  let store: SqliteKnowledgeStore;
  let analytics: DefaultCodeAnalytics;

  beforeEach(() => {
    store = new SqliteKnowledgeStore(':memory:');
    analytics = new DefaultCodeAnalytics(store, '/project');
  });

  // ==========================================================
  // TC-UT-CA-001: listSymbols 返回已索引符号
  // ==========================================================
  it('TC-UT-CA-001: should list indexed symbols', async () => {
    store.symbolsUpsert([makeSymbol({ name: 'foo', id: 'sym_foo' })]);

    const results = await analytics.listSymbols({});

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('foo');
  });

  // ==========================================================
  // TC-UT-CA-002: listSymbols 按 kind 过滤
  // ==========================================================
  it('TC-UT-CA-002: should filter symbols by kind', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'foo', id: 'sym_foo', kind: 'function' }),
      makeSymbol({ name: 'bar', id: 'sym_bar', kind: 'class' }),
    ]);

    const results = await analytics.listSymbols({ kind: 'class' });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('bar');
  });

  // ==========================================================
  // TC-UT-CA-003: listSymbols 仅返回导出符号
  // ==========================================================
  it('TC-UT-CA-003: should filter exported symbols only', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'pub', id: 'sym_pub', is_exported: true }),
      makeSymbol({ name: 'priv', id: 'sym_priv', is_exported: false }),
    ]);

    const results = await analytics.listSymbols({ exportedOnly: true });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('pub');
  });

  // ==========================================================
  // TC-UT-CA-004: listSymbols 按文件路径过滤
  // ==========================================================
  it('TC-UT-CA-004: should filter symbols by file path', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'a', id: 'sym_a', location: { file_path: 'src/a.ts', line_start: 1, line_end: 1, col_start: 0, col_end: 1 } }),
      makeSymbol({ name: 'b', id: 'sym_b', location: { file_path: 'src/b.ts', line_start: 1, line_end: 1, col_start: 0, col_end: 1 } }),
    ]);

    const results = await analytics.listSymbols({ filePath: 'src/a.ts' });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('a');
  });

  // ==========================================================
  // TC-UT-CA-005: mostCalledFunctions 按调用次数排序
  // ==========================================================
  it('TC-UT-CA-005: should rank functions by call count', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'hot', id: 'sym_hot' }),
      makeSymbol({ name: 'cold', id: 'sym_cold' }),
    ]);
    store.refsUpsert([
      makeRef({ source_symbol_id: 'sym_x1', target_symbol_id: 'sym_hot', kind: 'call' }),
      makeRef({ source_symbol_id: 'sym_x2', target_symbol_id: 'sym_hot', kind: 'call' }),
      makeRef({ source_symbol_id: 'sym_x3', target_symbol_id: 'sym_cold', kind: 'call' }),
    ]);

    const results = await analytics.mostCalledFunctions(2);

    expect(results).toHaveLength(2);
    expect(results[0].symbol.name).toBe('hot');
    expect(results[0].metric).toBe(2);
    expect(results[1].symbol.name).toBe('cold');
    expect(results[1].metric).toBe(1);
  });

  // ==========================================================
  // TC-UT-CA-006: mostImpactfulSymbols 按影响范围排序
  // ==========================================================
  it('TC-UT-CA-006: should rank symbols by number of callers', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'core', id: 'sym_core' }),
      makeSymbol({ name: 'leaf', id: 'sym_leaf' }),
    ]);
    store.refsUpsert([
      makeRef({ source_symbol_id: 'sym_a', target_symbol_id: 'sym_core', kind: 'call' }),
      makeRef({ source_symbol_id: 'sym_b', target_symbol_id: 'sym_core', kind: 'call' }),
      makeRef({ source_symbol_id: 'sym_c', target_symbol_id: 'sym_leaf', kind: 'call' }),
    ]);

    const results = await analytics.mostImpactfulSymbols(2);

    expect(results[0].symbol.name).toBe('core');
    expect(results[0].metric).toBe(2);
    expect(results[1].symbol.name).toBe('leaf');
    expect(results[1].metric).toBe(1);
  });

  // ==========================================================
  // TC-UT-CA-007: unusedExports 返回未被调用的导出符号
  // ==========================================================
  it('TC-UT-CA-007: should detect unused exported symbols', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'used', id: 'sym_used', is_exported: true }),
      makeSymbol({ name: 'dead', id: 'sym_dead', is_exported: true }),
    ]);
    store.refsUpsert([
      makeRef({ source_symbol_id: 'sym_other', target_symbol_id: 'sym_used', kind: 'call' }),
    ]);

    const results = await analytics.unusedExports(10);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('dead');
  });

  // ==========================================================
  // TC-UT-CA-008: mostCoupledModules 按模块间引用计数排序
  // ==========================================================
  it('TC-UT-CA-008: should rank module pairs by reference count', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'a1', id: 'sym_a1', location: { file_path: 'src/a.ts', line_start: 1, line_end: 1, col_start: 0, col_end: 1 } }),
      makeSymbol({ name: 'b1', id: 'sym_b1', location: { file_path: 'src/b.ts', line_start: 1, line_end: 1, col_start: 0, col_end: 1 } }),
      makeSymbol({ name: 'c1', id: 'sym_c1', location: { file_path: 'src/c.ts', line_start: 1, line_end: 1, col_start: 0, col_end: 1 } }),
    ]);
    store.refsUpsert([
      makeRef({ source_symbol_id: 'sym_a1', target_symbol_id: 'sym_b1', kind: 'call' }),
      makeRef({ source_symbol_id: 'sym_a1', target_symbol_id: 'sym_b1', kind: 'type_use' }),
      makeRef({ source_symbol_id: 'sym_a1', target_symbol_id: 'sym_c1', kind: 'call' }),
    ]);

    const results = await analytics.mostCoupledModules(10);

    expect(results[0]).toMatchObject({ moduleA: 'src/a.ts', moduleB: 'src/b.ts', referenceCount: 2 });
    expect(results[1]).toMatchObject({ moduleA: 'src/a.ts', moduleB: 'src/c.ts', referenceCount: 1 });
  });

  // ==========================================================
  // TC-UT-CA-009: longestCallChains 返回最长调用链
  // ==========================================================
  it('TC-UT-CA-009: should find longest call chains', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'a', id: 'sym_a' }),
      makeSymbol({ name: 'b', id: 'sym_b' }),
      makeSymbol({ name: 'c', id: 'sym_c' }),
    ]);
    store.refsUpsert([
      makeRef({ source_symbol_id: 'sym_a', target_symbol_id: 'sym_b', kind: 'call' }),
      makeRef({ source_symbol_id: 'sym_b', target_symbol_id: 'sym_c', kind: 'call' }),
    ]);

    const results = await analytics.longestCallChains(5);

    expect(results).toHaveLength(1);
    expect(results[0].depth).toBe(3);
    expect(results[0].chain.map(s => s.name)).toEqual(['a', 'b', 'c']);
  });

  // ==========================================================
  // TC-UT-CA-010: findEntryPoints 返回导出且未被调用的符号
  // ==========================================================
  it('TC-UT-CA-010: should find exported symbols with no callers', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'entry', id: 'sym_entry', is_exported: true }),
      makeSymbol({ name: 'helper', id: 'sym_helper', is_exported: true }),
    ]);
    store.refsUpsert([
      makeRef({ source_symbol_id: 'sym_other', target_symbol_id: 'sym_helper', kind: 'call' }),
    ]);

    const results = await analytics.findEntryPoints();

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('entry');
  });

  // ==========================================================
  // TC-UT-CA-011: complexityScores 返回静态复杂度打分
  // ==========================================================
  it('TC-UT-CA-011: should score complexity based on parameters and references', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'complex', id: 'sym_complex', signature: 'a: number, b: string, c: boolean, d: any', is_exported: true }),
      makeSymbol({ name: 'simple', id: 'sym_simple', signature: 'x: number', is_exported: false }),
    ]);
    store.refsUpsert([
      makeRef({ source_symbol_id: 'sym_other1', target_symbol_id: 'sym_complex', kind: 'call' }),
      makeRef({ source_symbol_id: 'sym_other2', target_symbol_id: 'sym_complex', kind: 'call' }),
      makeRef({ source_symbol_id: 'sym_other3', target_symbol_id: 'sym_complex', kind: 'type_use' }),
    ]);

    const results = await analytics.complexityScores(10);

    expect(results[0].symbol.name).toBe('complex');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  // ==========================================================
  // TC-UT-CA-012: listTodoComments 扫描 TODO / FIXME / HACK
  // ==========================================================
  it('TC-UT-CA-012: should scan TODO, FIXME and HACK comments from project files', async () => {
    // 依赖真实文件扫描；在测试中使用临时目录
    const { tmpdir } = await import('os');
    const { mkdtempSync, writeFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const dir = mkdtempSync(join(tmpdir(), 'nodus-analytics-'));
    writeFileSync(join(dir, 'sample.ts'), '// TODO: fix this\nfunction foo() {}\n// FIXME: edge case\n// HACK: workaround\n');

    const localAnalytics = new DefaultCodeAnalytics(store, dir);
    const results = await localAnalytics.listTodoComments();

    rmSync(dir, { recursive: true, force: true });

    const kinds = results.map(r => r.kind).sort();
    expect(kinds).toEqual(['FIXME', 'HACK', 'TODO']);
    expect(results.every(r => r.filePath === 'sample.ts')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CA-013: mostChangedFiles 变更热点分析
  // ==========================================================
  it('TC-UT-CA-013: should rank files by git change count', async () => {
    const { tmpdir } = await import('os');
    const { mkdtempSync, writeFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { execSync } = await import('child_process');

    const dir = mkdtempSync(join(tmpdir(), 'nodus-analytics-git-'));
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com" && git config user.name "Test"', { cwd: dir, stdio: 'ignore' });

    writeFileSync(join(dir, 'hot.ts'), 'export const a = 1;\n');
    execSync('git add . && git commit -m "c1"', { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'hot.ts'), 'export const a = 2;\n');
    execSync('git add . && git commit -m "c2"', { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'cold.ts'), 'export const b = 1;\n');
    execSync('git add . && git commit -m "c3"', { cwd: dir, stdio: 'ignore' });

    const localAnalytics = new DefaultCodeAnalytics(store, dir);
    const results = await localAnalytics.mostChangedFiles(undefined, 10);

    rmSync(dir, { recursive: true, force: true });

    expect(results[0].filePath).toBe('hot.ts');
    expect(results[0].changeCount).toBeGreaterThan(results[1].changeCount);
  });

  // ==========================================================
  // TC-UT-CA-014: typeRelationships 返回实现关系
  // ==========================================================
  it('TC-UT-CA-014: typeRelationships returns implementations', async () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'IUserService', id: 'sym_iuser_service', kind: 'interface' }),
      makeSymbol({ name: 'UserService', id: 'sym_user_service', kind: 'class' }),
      makeSymbol({ name: 'MockUserService', id: 'sym_mock_user_service', kind: 'class' }),
    ]);
    store.refsUpsert([
      makeRef({ source_symbol_id: 'sym_user_service', target_symbol_id: 'sym_iuser_service', kind: 'interface_implements' }),
      makeRef({ source_symbol_id: 'sym_mock_user_service', target_symbol_id: 'sym_iuser_service', kind: 'interface_implements' }),
      makeRef({ source_symbol_id: 'sym_user_service', target_symbol_id: 'sym_iuser_service', kind: 'type_use' }),
    ]);

    const iface = store.symbolsFindByName('IUserService', 'interface', 1)[0]!;
    const rels = await analytics.typeRelationships(iface.id, 'implementation');

    expect(rels.length).toBeGreaterThanOrEqual(1);
    expect(rels.every(r => r.kind === 'implementation')).toBe(true);
    expect(rels.map(r => r.symbol.name).sort()).toEqual(['MockUserService', 'UserService']);
  });
});
