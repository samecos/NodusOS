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
