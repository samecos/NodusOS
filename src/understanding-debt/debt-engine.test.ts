// ============================================================
// DebtFormula / DebtEngine 单元测试
// Task 4: 公式纯函数测试（TC-UT-DE-001 ~ TC-UT-DE-007）
// Task 6 将在此文件追加 DebtEngineImpl 的 describe 块
// ============================================================

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
