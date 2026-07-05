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
