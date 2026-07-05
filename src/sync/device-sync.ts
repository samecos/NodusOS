// ============================================================
// DeviceSync — 多设备同步接口
// 支持查询历史、偏好、项目列表、会话状态、反馈数据的导入导出与合并。
// ============================================================

import type { SyncData } from '../common/types.js';

export interface SyncOptions {
  /** 增量同步：只同步该时间戳之后的数据 */
  since?: string;
  /** 是否包含反馈数据（默认 true） */
  includeFeedback?: boolean;
  /** 设备标识（默认自动生成） */
  deviceId?: string;
}

export interface SyncResult {
  /** 同步是否成功 */
  success: boolean;
  /** 同步完成时间戳 */
  syncedAt: string;
  /** 各数据类型的同步统计 */
  stats: {
    queryHistoryAdded: number;
    queryHistorySkipped: number;
    preferencesUpdated: number;
    projectsAdded: number;
    projectsUpdated: number;
    sessionStatesAdded: number;
    sessionStatesUpdated: number;
    feedbackEntriesAdded: number;
  };
  /** 同步过程中的错误信息 */
  errors: string[];
}

export interface DeviceSync {
  /** 导出同步数据包。从 KnowledgeStore 和 feedback.jsonl 收集可同步数据。 */
  exportSyncData(options?: SyncOptions): SyncData;

  /** 导入并合并同步数据。将远程数据合并到本地 KnowledgeStore。 */
  importSyncData(data: SyncData, options?: { merge?: boolean }): SyncResult;

  /**
   * 执行完整同步流程：
   * 1. 导出本地数据
   * 2. 与远程数据双向合并
   * 3. 导入合并结果到本地
   */
  sync(remoteData: SyncData, options?: SyncOptions): SyncResult;
}
