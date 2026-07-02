// ============================================================
// CodeAnalytics — 代码库级聚合、统计与分析接口
// ============================================================

import type { Symbol, SymbolId, SymbolKind, Reference } from '../common/types.js';
import type { TypeRelationship, RelationshipKind } from './code-intelligence.js';

export interface SymbolMetric {
  symbol: Symbol;
  metric: number;
  detail?: string;
}

export interface ModuleCoupling {
  moduleA: string;
  moduleB: string;
  referenceCount: number;
}

export interface CallChain {
  chain: Symbol[];
  depth: number;
}

export interface ComplexityScore {
  symbol: Symbol;
  score: number;
  factors: string[];
}

export interface TodoComment {
  filePath: string;
  line: number;
  text: string;
  kind: 'TODO' | 'FIXME' | 'HACK';
}

export interface SymbolListFilter {
  kind?: SymbolKind;
  exportedOnly?: boolean;
  filePath?: string;
  modulePath?: string;
  limit?: number;
}

export interface CodeAnalytics {
  /** 枚举符号，支持按 kind/导出状态/文件/模块过滤 */
  listSymbols(filter: SymbolListFilter): Promise<Symbol[]>;

  /** 调用次数最多的函数/方法 Top-N */
  mostCalledFunctions(limit: number): Promise<SymbolMetric[]>;

  /** 影响范围（直接 + 间接调用方数量）最大的符号 Top-N */
  mostImpactfulSymbols(limit: number): Promise<SymbolMetric[]>;

  /** 未被使用的导出符号（潜在死代码）Top-N */
  unusedExports(limit: number): Promise<Symbol[]>;

  /** 模块间耦合度最高的模块对 Top-N */
  mostCoupledModules(limit: number): Promise<ModuleCoupling[]>;

  /** 最长的调用链 Top-N */
  longestCallChains(limit: number): Promise<CallChain[]>;

  /** 查找入口点：导出且未被项目内调用的符号 */
  findEntryPoints(): Promise<Symbol[]>;

  /** 扫描项目中的 TODO / FIXME / HACK 注释 */
  listTodoComments(): Promise<TodoComment[]>;

  /** 静态复杂度/计算密集度打分 Top-N */
  complexityScores(limit: number): Promise<ComplexityScore[]>;

  /** 给定时间范围内的变更热点文件 Top-N */
  mostChangedFiles(timeRange: { from: Date; to: Date } | undefined, limit: number): Promise<{ filePath: string; changeCount: number }[]>;

  /** 查询某个符号的指定类型关系（子类、实现、类型使用） */
  typeRelationships(symbolId: SymbolId, kind: RelationshipKind): Promise<TypeRelationship[]>;
}

export type { Symbol, SymbolId, SymbolKind, Reference } from '../common/types.js';
