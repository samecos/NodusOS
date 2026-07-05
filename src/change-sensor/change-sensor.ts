import type { ChangeBatch } from '../common/types.js';

/**
 * 变更传感器 — 旁观者：监听 Git/文件变更，打包成 ChangeBatch
 */
export interface ChangeSensor {
  /** 启动监听 */
  start(projectRoot: string): void;
  /** 停止监听 */
  stop(): void;
  /** 注册批次回调 */
  onBatch(handler: (batch: ChangeBatch) => void): () => void;
  /** 手动触发一次检测（用于测试 / REPL 主动查询） */
  detect(projectRoot: string): Promise<ChangeBatch | null>;
}
