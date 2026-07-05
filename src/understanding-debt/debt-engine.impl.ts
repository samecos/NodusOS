import type { ChangeBatch, DebtEntry } from '../common/types.js';
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

  private toQueryResult(entry: DebtEntry): DebtQueryResult {
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
