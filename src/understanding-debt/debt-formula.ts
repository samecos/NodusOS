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
