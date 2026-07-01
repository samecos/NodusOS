// ============================================================
// KnowledgeStore 单元测试 — TC-UT-KS-001 ~ TC-UT-KS-018
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteKnowledgeStore } from './knowledge-store.impl.js';
import type { Symbol, Reference, CallGraph, ProjectMeta } from '../common/types.js';

// 测试辅助：创建测试符号
function makeSymbol(overrides: Partial<Symbol> = {}): Symbol {
  return {
    id: `sym_${overrides.name ?? 'test'}_hash`,
    name: 'testFunction',
    kind: 'function',
    language: 'typescript',
    location: {
      file_path: 'src/test.ts',
      line_start: 1,
      line_end: 5,
      col_start: 1,
      col_end: 2,
    },
    is_exported: true,
    ...overrides,
  };
}

function makeRef(overrides: Partial<Reference> = {}): Reference {
  return {
    id: `ref_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    source_symbol_id: 'sym_A',
    target_symbol_id: 'sym_B',
    location: { file_path: 'src/test.ts', line_start: 10, line_end: 10, col_start: 1, col_end: 5 },
    kind: 'call',
    ...overrides,
  };
}

describe('KnowledgeStore', () => {
  let store: SqliteKnowledgeStore;

  beforeEach(() => {
    store = new SqliteKnowledgeStore(':memory:');
  });

  // ==========================================================
  // TC-UT-KS-001: 插入单个符号
  // ==========================================================
  it('TC-UT-KS-001: should insert a single symbol', () => {
    const sym = makeSymbol({ name: 'foo', id: 'hash_foo' });

    const count = store.symbolsUpsert([sym]);
    expect(count).toBe(1);

    const results = store.symbolsFindByName('foo');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('foo');
    expect(results[0].kind).toBe('function');
  });

  // ==========================================================
  // TC-UT-KS-002: 批量插入符号 — 幂等性
  // ==========================================================
  it('TC-UT-KS-002: upsert should be idempotent', () => {
    const sym = makeSymbol({ name: 'bar', id: 'hash_bar' });

    store.symbolsUpsert([sym]);
    const count = store.symbolsUpsert([sym]); // 再次插入同一符号

    expect(count).toBe(1); // 仍是 1 行，不重复
    const results = store.symbolsFindByName('bar');
    expect(results).toHaveLength(1);
  });

  // ==========================================================
  // TC-UT-KS-003: 按文件删除符号
  // ==========================================================
  it('TC-UT-KS-003: should remove symbols by file path', () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'fnA', id: 'a1', location: { file_path: 'src/a.ts', line_start: 1, line_end: 1, col_start: 1, col_end: 1 } }),
      makeSymbol({ name: 'fnB', id: 'a2', location: { file_path: 'src/a.ts', line_start: 2, line_end: 2, col_start: 1, col_end: 1 } }),
      makeSymbol({ name: 'fnC', id: 'b1', location: { file_path: 'src/b.ts', line_start: 1, line_end: 1, col_start: 1, col_end: 1 } }),
    ]);

    const removed = store.symbolsRemove('src/a.ts');
    expect(removed).toBe(2);

    expect(store.symbolsFindByFile('src/a.ts')).toHaveLength(0);
    expect(store.symbolsFindByFile('src/b.ts')).toHaveLength(1);
  });

  // ==========================================================
  // TC-UT-KS-004: 按名称模糊查找
  // ==========================================================
  it('TC-UT-KS-004: should fuzzy find by name', () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'getUserByEmail', id: 'e1' }),
      makeSymbol({ name: 'getUserById', id: 'e2' }),
      makeSymbol({ name: 'getOrderById', id: 'e3' }),
    ]);

    const results = store.symbolsFindByName('getUser');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.name).sort()).toEqual(['getUserByEmail', 'getUserById']);
  });

  // ==========================================================
  // TC-UT-KS-005: 按种类过滤
  // ==========================================================
  it('TC-UT-KS-005: should filter by symbol kind', () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'fnA', id: 'k1', kind: 'function' }),
      makeSymbol({ name: 'ClassX', id: 'k2', kind: 'class' }),
      makeSymbol({ name: 'fnB', id: 'k3', kind: 'function' }),
    ]);

    const functions = store.symbolsFindByName('fn', 'function');
    expect(functions).toHaveLength(2);
    expect(functions.every(s => s.kind === 'function')).toBe(true);
  });

  // ==========================================================
  // TC-UT-KS-006: 按文件查找符号
  // ==========================================================
  it('TC-UT-KS-006: should find symbols by file path', () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'fnA', id: 'f1', location: { file_path: 'src/payment.ts', line_start: 1, line_end: 1, col_start: 1, col_end: 1 } }),
      makeSymbol({ name: 'fnB', id: 'f2', location: { file_path: 'src/payment.ts', line_start: 10, line_end: 10, col_start: 1, col_end: 1 } }),
      makeSymbol({ name: 'fnC', id: 'f3', location: { file_path: 'src/order.ts', line_start: 1, line_end: 1, col_start: 1, col_end: 1 } }),
    ]);

    const results = store.symbolsFindByFile('src/payment.ts');
    expect(results).toHaveLength(2);
    expect(results[0].location.line_start).toBeLessThan(results[1].location.line_start);
  });

  // ==========================================================
  // TC-UT-KS-008: 模糊搜索
  // ==========================================================
  it('TC-UT-KS-008: should search symbols with fuzzy query', () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'refundOrder', id: 's1' }),
      makeSymbol({ name: 'orderRefund', id: 's2' }),
      makeSymbol({ name: 'processRefund', id: 's3' }),
      makeSymbol({ name: 'createPayment', id: 's4' }),
    ]);

    const results = store.symbolsSearch('refund');
    expect(results).toHaveLength(3);
  });

  // ==========================================================
  // TC-UT-KS-009: 插入引用关系
  // ==========================================================
  it('TC-UT-KS-009: should insert reference relations', () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'caller', id: 'sym_A' }),
      makeSymbol({ name: 'callee', id: 'sym_B' }),
    ]);

    const ref = makeRef({ source_symbol_id: 'sym_A', target_symbol_id: 'sym_B' });
    const count = store.refsUpsert([ref]);
    expect(count).toBe(1);

    const refs = store.refsFindByTarget('sym_B');
    expect(refs).toHaveLength(1);
    expect(refs[0].source_symbol_id).toBe('sym_A');
  });

  // ==========================================================
  // TC-UT-KS-010: 按目标查引用
  // ==========================================================
  it('TC-UT-KS-010: should find refs by target symbol', () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'target', id: 'sym_T' }),
      makeSymbol({ name: 'srcA', id: 'sym_SA' }),
      makeSymbol({ name: 'srcB', id: 'sym_SB' }),
      makeSymbol({ name: 'srcC', id: 'sym_SC' }),
    ]);

    store.refsUpsert([
      makeRef({ id: 'r1', source_symbol_id: 'sym_SA', target_symbol_id: 'sym_T' }),
      makeRef({ id: 'r2', source_symbol_id: 'sym_SB', target_symbol_id: 'sym_T' }),
      makeRef({ id: 'r3', source_symbol_id: 'sym_SC', target_symbol_id: 'sym_T' }),
    ]);

    const refs = store.refsFindByTarget('sym_T');
    expect(refs).toHaveLength(3);
  });

  // ==========================================================
  // TC-UT-KS-012: 删除文件时级联删除引用
  // ==========================================================
  it('TC-UT-KS-012: should cascade delete refs when removing file', () => {
    store.symbolsUpsert([
      makeSymbol({ name: 'fn', id: 'f1', location: { file_path: 'src/old.ts', line_start: 1, line_end: 1, col_start: 1, col_end: 1 } }),
    ]);
    store.refsUpsert([
      makeRef({ id: 'r1', source_symbol_id: 'f1', target_symbol_id: 'ext', location: { file_path: 'src/old.ts', line_start: 5, line_end: 5, col_start: 1, col_end: 1 } }),
      makeRef({ id: 'r2', source_symbol_id: 'f1', target_symbol_id: 'ext2', location: { file_path: 'src/old.ts', line_start: 10, line_end: 10, col_start: 1, col_end: 1 } }),
    ]);

    const removed = store.refsRemoveForFile('src/old.ts');
    expect(removed).toBe(2);
  });

  // ==========================================================
  // TC-UT-KS-013/014: 调用图存储和获取
  // ==========================================================
  it('TC-UT-KS-013: should store and retrieve call graph', () => {
    const graph: CallGraph = {
      root_symbol_id: 'sym_root',
      direction: 'both',
      max_depth: 3,
      nodes: [
        { symbol_id: 'sym_root', symbol_name: 'rootFn', file_path: 'src/a.ts', line: 1, depth: 0 },
        { symbol_id: 'sym_child', symbol_name: 'childFn', file_path: 'src/b.ts', line: 5, depth: 1 },
      ],
      edges: [
        { from: 'sym_root', to: 'sym_child', kind: 'call' },
      ],
    };

    store.callgraphStore(graph);
    const retrieved = store.callgraphGet('sym_root', 'both', 3);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.nodes).toHaveLength(2);
    expect(retrieved!.edges).toHaveLength(1);
  });

  // ==========================================================
  // TC-UT-KS-015: 项目 CRUD
  // ==========================================================
  it('TC-UT-KS-015: should CRUD projects', () => {
    const meta: ProjectMeta = {
      name: 'myapp',
      root_path: '/home/dev/myapp',
      languages: ['typescript'],
      runtimes: [{ language: 'typescript', constraint: '>=18.0.0', specified_in: 'package.json' }],
      dependencies: [],
    };

    store.projectUpsert(meta);
    const retrieved = store.projectGet('/home/dev/myapp');
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('myapp');
    expect(retrieved!.languages).toEqual(['typescript']);

    const list = store.projectList();
    expect(list).toHaveLength(1);
  });

  // ==========================================================
  // TC-UT-KS-016: 用户偏好读写
  // ==========================================================
  it('TC-UT-KS-016: should read and write preferences', () => {
    // 不存在的 key
    expect(store.prefGet('voice.wake_word')).toBeUndefined();

    // 写入
    store.prefSet('voice.wake_word', 'Nodus');
    expect(store.prefGet('voice.wake_word')).toBe('Nodus');

    // 删除
    store.prefDelete('voice.wake_word');
    expect(store.prefGet('voice.wake_word')).toBeUndefined();
  });

  // ==========================================================
  // TC-UT-KS-017/018: 查询历史
  // ==========================================================
  it('TC-UT-KS-017: should record and retrieve query history', () => {
    store.historyRecord({
      raw_text: 'find refundOrder',
      intent_type: 'find_definition',
      latency_ms: 150,
      result_count: 1,
      timestamp: new Date().toISOString(),
    });

    const recent = store.historyRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].raw_text).toBe('find refundOrder');
  });

  it('TC-UT-KS-018: should limit query history', () => {
    for (let i = 0; i < 100; i++) {
      store.historyRecord({
        raw_text: `query ${i}`,
        latency_ms: 100,
        result_count: 1,
        timestamp: new Date().toISOString(),
      });
    }

    const recent = store.historyRecent(5);
    expect(recent).toHaveLength(5);
    // 最近的在前面
    expect(recent[0].raw_text).toBe('query 99');
  });
});
