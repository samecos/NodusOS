// ============================================================
// KnowledgeStore — 持久化存储层接口
// 与 ArchitecturalDesignPhase/04-API-Reference.md §11 一致
// ============================================================

import type {
  Symbol, SymbolId, SymbolKind,
  Reference, ReferenceKind,
  CallGraph, CallDirection,
  ProjectMeta, QueryHistoryEntry,
} from '../common/types.js';

export interface KnowledgeStore {
  // ---- 符号操作 ----
  symbolsUpsert(symbols: Symbol[]): number;
  symbolsRemove(filePath: string): number;
  symbolsFindByName(name: string, kind?: SymbolKind, limit?: number): Symbol[];
  symbolsFindByFile(filePath: string): Symbol[];
  symbolsFindByModule(modulePath: string): Symbol[];
  symbolsSearch(query: string, limit?: number): Symbol[];

  // ---- 引用操作 ----
  refsUpsert(refs: Reference[]): number;
  refsRemoveForFile(filePath: string): number;
  refsFindByTarget(symbolId: SymbolId): Reference[];
  refsFindBySource(symbolId: SymbolId): Reference[];

  // ---- 调用图 ----
  callgraphStore(graph: CallGraph): void;
  callgraphGet(symbolId: SymbolId, direction: CallDirection, maxDepth: number): CallGraph | null;
  callgraphRebuildForFile(filePath: string): void;

  // ---- 项目 ----
  projectGet(path: string): ProjectMeta | undefined;
  projectUpsert(meta: ProjectMeta): void;
  projectList(): ProjectMeta[];

  // ---- 偏好 ----
  prefGet(key: string): unknown;
  prefSet(key: string, value: unknown): void;
  prefDelete(key: string): void;

  // ---- 查询历史 ----
  historyRecord(entry: QueryHistoryEntry): void;
  historyRecent(limit: number): QueryHistoryEntry[];

  // ---- 生命周期 ----
  close(): void;
}
