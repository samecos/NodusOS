// ============================================================
// CodeIntelligence — 语义索引引擎接口
// 与 ArchitecturalDesignPhase/04-API-Reference.md §5 一致
// ============================================================

import type {
  Symbol, SymbolId, SymbolKind, Language,
  Reference, CallGraph, CallDirection,
  IndexStatus, QueryHistoryEntry,
  ChangeScope, IntentType, RiskLevel,
} from '../common/types.js';

// ---- 报告类型 ----

export interface IndexReport {
  filesIndexed: number;
  filesFailed: number;
  symbolsFound: number;
  referencesFound: number;
  durationMs: number;
  errors: Array<{ file: string; error: string }>;
}

export interface FileIndexResult {
  symbolsAdded: number;
  symbolsRemoved: number;
  referencesUpdated: number;
  durationMs: number;
}

export interface ImpactReport {
  symbol: Symbol;
  directCallers: Symbol[];
  transitiveCallers: Symbol[];
  affectedFiles: string[];
  riskLevel: RiskLevel;
}

export interface ChangeRecord {
  commitHash: string;
  commitMessage: string;
  author: string;
  timestamp: string;
  changedSymbols: Symbol[];
  diffSummary: string;
}

// ---- QueryIntent ----

export interface QueryIntent {
  rawText: string;
  intentType: IntentType;
  confidence: number;
  entities: {
    symbolName?: string;
    filePath?: string;
    moduleName?: string;
    timeRange?: { from: Date; to: Date };
    author?: string;
  };
  context?: {
    activeFile?: string;
    cursorSymbol?: string;
    selectedCode?: string;
  };
  candidates?: QueryIntent[];
}

// ---- QueryResult ----

export type QueryResult =
  | { kind: 'symbol_list'; symbols: Symbol[] }
  | { kind: 'reference_list'; references: Reference[] }
  | { kind: 'call_graph'; graph: CallGraph }
  | { kind: 'impact_report'; report: ImpactReport }
  | { kind: 'change_history'; records: ChangeRecord[] }
  | { kind: 'symbol_overview'; symbols: Symbol[] };

// ---- Main interface ----

export interface CodeIntelligence {
  // 依赖注入
  setGitIntel(git: import('../git-intel/git-intelligence.js').GitIntelligence): void;

  // 索引管理
  indexProject(projectRoot: string, languages: Language[]): Promise<IndexReport>;
  indexFile(filePath: string): Promise<FileIndexResult>;
  indexStatus(): IndexStatus;

  // 查询
  findSymbol(name: string, kind?: SymbolKind, fileFilter?: string, limit?: number): Promise<Symbol[]>;
  findReferences(symbolId: SymbolId): Promise<Reference[]>;
  callGraph(symbolId: SymbolId, direction: CallDirection, maxDepth: number): Promise<CallGraph | null>;
  symbolsInFile(filePath: string): Promise<Symbol[]>;
  impactAnalysis(symbolId: SymbolId): Promise<ImpactReport | null>;
  changeHistory(scope: ChangeScope, timeRange?: { from: Date; to: Date }): Promise<ChangeRecord[]>;
  query(intent: QueryIntent): Promise<QueryResult>;
}

export type { ChangeScope } from '../git-intel/git-intelligence.js';
