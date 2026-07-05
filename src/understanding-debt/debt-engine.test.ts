// ============================================================
// DebtFormula / DebtEngine 单元测试
// Task 4: 公式纯函数测试（TC-UT-DE-001 ~ TC-UT-DE-007）
// Task 6 将在此文件追加 DebtEngineImpl 的 describe 块
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { MigrationRunner } from '../store/migrations.js';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { DebtEngineImpl } from './debt-engine.impl.js';
import type { ChangeBatch } from '../common/types.js';
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
