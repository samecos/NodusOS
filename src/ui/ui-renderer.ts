// ============================================================
// UIRenderer — 结果格式化与 UI 抽象接口
// 包括：卡片系统、呼吸灯、输入条、代码导航。
// ============================================================

import type { QueryResult } from '../code-intel/code-intelligence.js';
import type { IntentError, QueryIntent } from '../intent/intent-engine.js';
import type { ProjectMeta } from '../common/types.js';
import type { EnvStatus } from '../env-mgr/environment-manager.js';
import { type NodusError } from '../common/errors.js';

/** 查询历史展示条目 */
export interface HistoryItem {
  text: string;
  intentType: string | null;
  timestamp: string;
}

/** 推荐展示条目 */
export interface RecommendationItem {
  text: string;
  reason: string;
}

export type CardKind =
  | 'symbol_list'
  | 'reference_list'
  | 'call_graph'
  | 'impact_report'
  | 'change_history'
  | 'symbol_overview'
  | 'symbol_ranking'
  | 'module_coupling'
  | 'call_chain'
  | 'todo_list'
  | 'stats_report'
  | 'change_heat'
  | 'ambiguity'
  | 'env_status'
  | 'type_relationship_list'
  | 'history_list'
  | 'recommendation_list'
  | 'notification'
  | 'error';

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  /** 卡片原始数据，由具体渲染器决定如何呈现 */
  data:
    | QueryResult
    | IntentError
    | ProjectMeta
    | QueryIntent[]
    | HistoryItem[]
    | RecommendationItem[]
    | { title: string; body: string }
    | { kind: 'error'; error: NodusError; module: string };
  createdAt: string;
  /** 可选的存活时间（秒），undefined 表示手动关闭 */
  ttlSeconds?: number;
}

export type BreathLightState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface UIRenderer {
  // ---- 基础渲染 ----
  /** 格式化查询结果 */
  render(result: QueryResult): string;

  /** 格式化意图错误 */
  renderError(error: IntentError): string;

  /** 格式化通知 */
  renderNotification(title: string, body: string): string;

  /** 渲染查询历史列表 */
  renderHistory(items: HistoryItem[]): string;

  /** 渲染推荐列表 */
  renderRecommendations(items: RecommendationItem[]): string;

  // ---- 卡片系统 ----
  /** 创建一张结果卡片 */
  createCard(
    id: string,
    title: string,
    data:
      | QueryResult
      | IntentError
      | ProjectMeta
      | QueryIntent[]
      | HistoryItem[]
      | RecommendationItem[]
      | { title: string; body: string }
      | { kind: 'error'; error: NodusError; module: string },
    ttlSeconds?: number,
  ): Card;

  /** 关闭指定卡片 */
  dismissCard(id: string): void;

  /** 列出当前存活的所有卡片 */
  listCards(): Card[];

  /** 渲染单张卡片为字符串（终端渲染器）或返回渲染指令（GUI 渲染器） */
  renderCard(card: Card): string;

  // ---- 呼吸灯 ----
  /** 设置全局状态指示灯 */
  setBreathLight(state: BreathLightState): void;

  // ---- 输入条 ----
  /** 显示输入条 */
  showInput(placeholder?: string): void;

  /** 隐藏输入条 */
  hideInput(): void;

  /** 设置输入条当前文本 */
  setInputText(text: string): void;

  // ---- 代码导航 ----
  /** 跳转到代码中的指定符号位置（GUI 环境）；终端环境可输出定位信息 */
  navigateToSymbol(filePath: string, line: number, column?: number): void;

  /** 渲染指定文件的代码片段 */
  renderCodeSnippet(filePath: string, lineRange: { start: number; end: number }, language?: import('../common/types.js').Language): string;
}

// ============================================================
// 错误卡片构建辅助函数
// ============================================================

/**
 * 构造统一的 NodusError 降级卡片。
 *
 * @param uiRenderer 渲染器实例
 * @param error 要展示的错误
 * @param module 来源模块名
 * @param title 卡片标题，默认为 "运行降级提示"
 * @returns 包含 kind='error' 的 Card 对象
 */
export function createErrorCard(
  uiRenderer: UIRenderer,
  error: NodusError,
  module: string,
  title = '运行降级提示',
): Card {
  return uiRenderer.createCard(
    `error-${error.code}-${Date.now()}`,
    title,
    { kind: 'error', error, module },
  );
}
