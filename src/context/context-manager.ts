// ============================================================
// ContextManager — 开发者上下文追踪
// 与 ArchitecturalDesignPhase/04-API-Reference.md §4 一致
// ============================================================

import type { IntentType } from '../common/types.js';

/** 上下文快照。高频读取，延迟 < 1ms。 */
export interface Context {
  active_file: string | null;
  cursor_line: number | null;
  cursor_col: number | null;
  cursor_symbol: string | null;
  selected_code: string | null;
  selected_range: [number, number] | null;
  recent_queries: RecentQuery[];
  active_project_root: string;
}

export interface RecentQuery {
  text: string;
  intent_type: IntentType | null;
  timestamp: string;
}

/** 上下文变更事件 */
export type ContextDelta =
  | { kind: 'file_opened'; path: string }
  | { kind: 'file_closed'; path: string }
  | { kind: 'cursor_moved'; file: string; line: number; col: number; symbol: string | null }
  | { kind: 'selection_changed'; file: string; range: [number, number]; code: string }
  | { kind: 'project_changed'; root: string };

export interface ContextManager {
  /** 获取当前完整上下文快照 */
  snapshot(): Context;

  /** 更新上下文，内部通知监听者 */
  update(delta: ContextDelta): void;

  /** 记录一次查询（更新 recent_queries） */
  recordQuery(text: string, intentType: IntentType | null): void;

  /** 订阅上下文变更 */
  onChange(handler: (delta: ContextDelta) => void): () => void;
}
