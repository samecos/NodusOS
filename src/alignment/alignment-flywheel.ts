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
