// ============================================================
// KnowledgeStore — 持久化存储层接口
// 与 ArchitecturalDesignPhase/04-API-Reference.md §11 一致
// ============================================================

import type {
  Symbol, SymbolId, SymbolKind,
  Reference, ReferenceKind,
  CallGraph, CallDirection,
  ProjectMeta, QueryHistoryEntry,
  FileIndexState, RuntimeRequirement, Dependency,
  SessionState, AnnotationEntry,
} from '../common/types.js';

export interface KnowledgeStore {
  // ---- 符号操作 ----
  symbolsUpsert(symbols: Symbol[]): number;
  symbolsRemove(filePath: string): number;
  symbolsFindByName(name: string, kind?: SymbolKind, limit?: number): Symbol[];
  symbolsFindById(id: SymbolId): Symbol | undefined;
  symbolsFindByFile(filePath: string): Symbol[];
  symbolsFindByModule(modulePath: string): Symbol[];
  symbolsFindAll(): Symbol[];
  symbolsSearch(query: string, limit?: number): Symbol[];

  // ---- 引用操作 ----
  refsUpsert(refs: Reference[]): number;
  refsRemoveForFile(filePath: string): number;
  refsFindByFile(filePath: string): Reference[];
  refsFindByTarget(symbolId: SymbolId): Reference[];
  refsFindBySource(symbolId: SymbolId): Reference[];
  refsFindAll(): Reference[];

  // ---- 调用图 ----
  callgraphStore(graph: CallGraph): void;
  callgraphGet(symbolId: SymbolId, direction: CallDirection, maxDepth: number): CallGraph | null;
  callgraphRebuildForFile(filePath: string): void;

  // ---- 文件索引状态 ----
  fileStateGet(filePath: string): FileIndexState | undefined;
  fileStateUpsert(state: FileIndexState): void;
  fileStateRemove(filePath: string): void;

  // ---- 项目 ----
  projectGet(path: string): ProjectMeta | undefined;
  projectGetFull(path: string): ProjectMeta | undefined;
  projectUpsert(meta: ProjectMeta): void;
  projectUpsertFull(meta: ProjectMeta): void;
  projectList(): ProjectMeta[];

  // ---- 项目运行时 ----
  runtimesGet(projectPath: string): RuntimeRequirement[];
  runtimesUpsert(projectPath: string, runtimes: RuntimeRequirement[]): void;

  // ---- 项目依赖 ----
  dependenciesGet(projectPath: string): Dependency[];
  dependenciesUpsert(projectPath: string, dependencies: Dependency[]): void;

  // ---- 偏好 ----
  prefGet(key: string): unknown;
  prefSet(key: string, value: unknown): void;
  prefDelete(key: string): void;
  /** 列出所有偏好键值对 */
  prefList(): Record<string, unknown>;

  // ---- 查询历史 ----
  historyRecord(entry: QueryHistoryEntry): void;
  historyRecent(limit: number): QueryHistoryEntry[];
  /** 按关键词模糊搜索查询历史 */
  historySearch(keyword: string, limit?: number): QueryHistoryEntry[];
  /** 清理指定日期之前的查询历史，返回删除条数 */
  historyCleanup(beforeDate?: string): number;

  // ---- 会话状态 ----
  sessionStateGet(projectRoot: string): SessionState | undefined;
  sessionStateUpsert(state: SessionState): void;
  sessionStateRemove(projectRoot: string): void;

  // ---- 人工标注 ----
  annotationRecord(entry: Omit<AnnotationEntry, 'id'>): number;
  annotationGet(id: number): AnnotationEntry | undefined;
  annotationList(limit?: number): AnnotationEntry[];
  annotationUpdate(id: number, updates: Partial<Omit<AnnotationEntry, 'id' | 'created_at'>>): boolean;
  annotationDelete(id: number): boolean;

  // ---- 生命周期 ----
  close(): void;
}
