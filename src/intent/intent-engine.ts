// ============================================================
// IntentEngine — NLU 意图解析
// 与 ArchitecturalDesignPhase/04-API-Reference.md §3 一致
// ============================================================

import type { IntentType } from '../common/types.js';

export type InputSource = 'voice' | 'text' | 'context_menu';

export interface IntentInput {
  source: InputSource;
  text: string;
  locale: string;
}

export interface IntentEntity {
  symbolName?: string;
  filePath?: string;
  moduleName?: string;
  projectPath?: string;
  timeRange?: { from: Date; to: Date };
  author?: string;
  /** analytics / stats 子类型，用于区分具体统计/分析动作 */
  subType?: string;
  /** list_symbols 的过滤条件 */
  filter?: {
    kind?: import('../common/types.js').SymbolKind;
    exportedOnly?: boolean;
    filePath?: string;
    modulePath?: string;
  };
  /** 类型关系意图的具体关系类型 */
  relationshipKind?: 'subclasses' | 'implementations' | 'type_uses';
  /** 代码评审意图的 commit hash */
  commitHash?: string;
  /** 代码生成意图的自然语言描述 */
  description?: string;
  /** 跨域调试意图的日志文本 */
  logText?: string;
  /** 团队协作注释/导入的内容 */
  content?: string;
}

export interface QueryIntent {
  rawText: string;
  intentType: IntentType;
  confidence: number;
  entities: IntentEntity;
  context?: {
    activeFile?: string;
    cursorSymbol?: string;
    selectedCode?: string;
    implicitParams?: Record<string, unknown>;
  };
  candidates?: QueryIntent[];
}

// Context 和 RecentQuery 从 context-manager 统一导入
// 避免类型重复定义不一致
import type { Context, RecentQuery } from '../context/context-manager.js';
export type { Context, RecentQuery };

export type IntentError =
  | { kind: 'empty_input' }
  | { kind: 'unparseable'; rawText: string }
  | { kind: 'ambiguous'; candidates: QueryIntent[] }
  | { kind: 'unsupported'; intentType: string };

export interface IntentEngine {
  /** 解析自然语言为结构化意图。同步，<200ms。 */
  parse(input: IntentInput, context: Context): QueryIntent | IntentError;

  /** 从歧义选项中选定 */
  resolveAmbiguity(candidates: QueryIntent[], chosenIndex: number): QueryIntent;

  /** 记录反馈用于持续优化 */
  recordFeedback(input: IntentInput, parsed: QueryIntent | null, actual: QueryIntent): void;

  /** 从 feedback.jsonl 加载用户确认的查询作为新例句，返回新学习数量 */
  loadFeedback(): number;

  /** 返回已学习例句数量 */
  getLearnedCount(): number;
}
