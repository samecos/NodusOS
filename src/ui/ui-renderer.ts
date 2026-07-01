// ============================================================
// UIRenderer — 结果格式化接口
// ============================================================

import type { QueryResult } from '../code-intel/code-intelligence.js';
import type { IntentError } from '../intent/intent-engine.js';

export interface UIRenderer {
  /** 格式化查询结果 */
  render(result: QueryResult): string;

  /** 格式化意图错误 */
  renderError(error: IntentError): string;

  /** 格式化通知 */
  renderNotification(title: string, body: string): string;
}
