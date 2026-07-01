// ============================================================
// SqliteKnowledgeStore — SQLite 实现
// ============================================================

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type {
  Symbol, SymbolId, SymbolKind,
  Reference,
  CallGraph, CallDirection,
  ProjectMeta, QueryHistoryEntry,
  PackageManager,
  FileIndexState, RuntimeRequirement, Dependency,
} from '../common/types.js';
import type { KnowledgeStore } from './knowledge-store.js';
import { MigrationRunner } from './migrations.js';

export class SqliteKnowledgeStore implements KnowledgeStore {
  private db: DatabaseType;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    new MigrationRunner(this.db).run();
  }

  // ========== 符号操作 ==========

  symbolsUpsert(symbols: Symbol[]): number {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO symbols
        (id, name, kind, language, file_path,
         line_start, line_end, col_start, col_end,
         parent_id, is_exported, signature, doc_comment, file_checksum)
      VALUES
        (@id, @name, @kind, @language, @file_path,
         @line_start, @line_end, @col_start, @col_end,
         @parent_id, @is_exported, @signature, @doc_comment, '')
    `);

    const tx = this.db.transaction((syms: Symbol[]) => {
      let count = 0;
      for (const s of syms) {
        const result = insert.run({
          id: s.id,
          name: s.name,
          kind: s.kind,
          language: s.language,
          file_path: s.location.file_path,
          line_start: s.location.line_start,
          line_end: s.location.line_end,
          col_start: s.location.col_start,
          col_end: s.location.col_end,
          parent_id: s.parent_id ?? null,
          is_exported: s.is_exported ? 1 : 0,
          signature: s.signature ?? null,
          doc_comment: s.doc_comment ?? null,
        });
        count += result.changes;
      }
      return count;
    });

    return tx(symbols);
  }

  symbolsRemove(filePath: string): number {
    const result = this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
    return result.changes;
  }

  symbolsFindByName(name: string, kind?: SymbolKind, limit = 10): Symbol[] {
    let sql = 'SELECT * FROM symbols WHERE name LIKE ?';
    const params: unknown[] = [`%${name}%`];
    if (kind) {
      sql += ' AND kind = ?';
      params.push(kind);
    }
    sql += ' LIMIT ?';
    params.push(limit);

    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map(this.rowToSymbol);
  }

  symbolsFindById(id: SymbolId): Symbol | undefined {
    const row = this.db.prepare('SELECT * FROM symbols WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSymbol(row) : undefined;
  }

  symbolsFindByFile(filePath: string): Symbol[] {
    const rows = this.db.prepare(
      'SELECT * FROM symbols WHERE file_path = ? ORDER BY line_start'
    ).all(filePath) as Record<string, unknown>[];
    return rows.map(this.rowToSymbol);
  }

  symbolsFindByModule(modulePath: string): Symbol[] {
    const rows = this.db.prepare(
      'SELECT * FROM symbols WHERE file_path LIKE ? ORDER BY file_path, line_start'
    ).all(`${modulePath}%`) as Record<string, unknown>[];
    return rows.map(this.rowToSymbol);
  }

  symbolsSearch(query: string, limit = 10): Symbol[] {
    const rows = this.db.prepare(
      'SELECT * FROM symbols WHERE name LIKE ? LIMIT ?'
    ).all(`%${query}%`, limit) as Record<string, unknown>[];
    return rows.map(this.rowToSymbol);
  }

  // ========== 引用操作 ==========

  refsUpsert(refs: Reference[]): number {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO refs (id, source_symbol_id, target_symbol_id, file_path, line, col, kind)
      VALUES (@id, @source_symbol_id, @target_symbol_id, @file_path, @line, @col, @kind)
    `);

    const tx = this.db.transaction((rfs: Reference[]) => {
      let count = 0;
      for (const r of rfs) {
        const result = insert.run({
          id: r.id,
          source_symbol_id: r.source_symbol_id,
          target_symbol_id: r.target_symbol_id,
          file_path: r.location.file_path,
          line: r.location.line_start,
          col: r.location.col_start,
          kind: r.kind,
        });
        count += result.changes;
      }
      return count;
    });

    return tx(refs);
  }

  refsRemoveForFile(filePath: string): number {
    const result = this.db.prepare('DELETE FROM refs WHERE file_path = ?').run(filePath);
    return result.changes;
  }

  refsFindByFile(filePath: string): Reference[] {
    const rows = this.db.prepare(
      'SELECT * FROM refs WHERE file_path = ? ORDER BY line, col'
    ).all(filePath) as Record<string, unknown>[];
    return rows.map(this.rowToRef);
  }

  refsFindByTarget(symbolId: SymbolId): Reference[] {
    const rows = this.db.prepare(
      'SELECT * FROM refs WHERE target_symbol_id = ?'
    ).all(symbolId) as Record<string, unknown>[];
    return rows.map(this.rowToRef);
  }

  refsFindBySource(symbolId: SymbolId): Reference[] {
    const rows = this.db.prepare(
      'SELECT * FROM refs WHERE source_symbol_id = ?'
    ).all(symbolId) as Record<string, unknown>[];
    return rows.map(this.rowToRef);
  }

  // ========== 调用图 ==========

  callgraphStore(graph: CallGraph): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO callgraphs (symbol_id, direction, max_depth, data) VALUES (?, ?, ?, ?)'
    ).run(graph.root_symbol_id, graph.direction, graph.max_depth, JSON.stringify(graph));
  }

  callgraphGet(symbolId: SymbolId, direction: CallDirection, maxDepth: number): CallGraph | null {
    const row = this.db.prepare(
      'SELECT data FROM callgraphs WHERE symbol_id = ? AND direction = ? AND max_depth = ?'
    ).get(symbolId, direction, maxDepth) as { data: string } | undefined;

    return row ? JSON.parse(row.data) as CallGraph : null;
  }

  callgraphRebuildForFile(_filePath: string): void {
    // MVP: 简单实现 — 标记相关调用图缓存失效
    // 完整实现需要找到所有包含该文件节点的调用图并重建
    this.db.prepare("DELETE FROM callgraphs WHERE data LIKE ?").run(`%${_filePath}%`);
  }

  // ========== 文件索引状态 ==========

  fileStateGet(filePath: string): FileIndexState | undefined {
    const row = this.db.prepare('SELECT * FROM file_index_state WHERE file_path = ?').get(filePath) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      file_path: row.file_path as string,
      checksum: row.checksum as string,
      symbol_count: row.symbol_count as number,
      indexed_at: row.indexed_at as string,
      error: (row.error as string | undefined) ?? undefined,
    } satisfies FileIndexState;
  }

  fileStateUpsert(state: FileIndexState): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO file_index_state (file_path, checksum, symbol_count, indexed_at, error)
      VALUES (?, ?, ?, ?, ?)
    `).run(state.file_path, state.checksum, state.symbol_count, state.indexed_at, state.error ?? null);
  }

  fileStateRemove(filePath: string): void {
    this.db.prepare('DELETE FROM file_index_state WHERE file_path = ?').run(filePath);
  }

  // ========== 项目 ==========

  projectGet(path: string): ProjectMeta | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE root_path = ?').get(path) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      name: row.name as string,
      root_path: row.root_path as string,
      languages: JSON.parse(row.languages as string),
      runtimes: JSON.parse(row.runtimes as string),
      package_manager: (row.package_manager as PackageManager | undefined),
      dependencies: JSON.parse(row.dependencies as string),
      framework: (row.framework as ProjectMeta['framework']),
    } satisfies ProjectMeta;
  }

  projectGetFull(path: string): ProjectMeta | undefined {
    const meta = this.projectGet(path);
    if (!meta) return undefined;
    return {
      ...meta,
      runtimes: this.runtimesGet(path),
      dependencies: this.dependenciesGet(path),
    };
  }

  projectUpsert(meta: ProjectMeta): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO projects (root_path, name, languages, runtimes, package_manager, dependencies, framework)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      meta.root_path, meta.name,
      JSON.stringify(meta.languages),
      JSON.stringify(meta.runtimes),
      meta.package_manager ?? null,
      JSON.stringify(meta.dependencies),
      meta.framework ?? null,
    );
  }

  projectUpsertFull(meta: ProjectMeta): void {
    this.projectUpsert(meta);
    this.runtimesUpsert(meta.root_path, meta.runtimes);
    this.dependenciesUpsert(meta.root_path, meta.dependencies);
  }

  projectList(): ProjectMeta[] {
    const rows = this.db.prepare('SELECT * FROM projects').all() as Record<string, unknown>[];
    return rows.map(row => ({
      name: row.name as string,
      root_path: row.root_path as string,
      languages: JSON.parse(row.languages as string),
      runtimes: JSON.parse(row.runtimes as string),
      package_manager: (row.package_manager as PackageManager | undefined),
      dependencies: JSON.parse(row.dependencies as string),
      framework: (row.framework as ProjectMeta['framework']),
    } satisfies ProjectMeta));
  }

  // ========== 项目运行时 ==========

  private projectIdByPath(projectPath: string): number | undefined {
    const row = this.db.prepare('SELECT id FROM projects WHERE root_path = ?').get(projectPath) as { id: number } | undefined;
    return row?.id;
  }

  runtimesGet(projectPath: string): RuntimeRequirement[] {
    const projectId = this.projectIdByPath(projectPath);
    if (!projectId) return [];

    const rows = this.db.prepare(
      'SELECT language, version_constraint, installed_version, specified_in FROM project_runtimes WHERE project_id = ?'
    ).all(projectId) as Record<string, unknown>[];

    return rows.map(row => ({
      language: row.language as RuntimeRequirement['language'],
      constraint: row.version_constraint as string,
      specified_in: row.specified_in as string,
    } satisfies RuntimeRequirement));
  }

  runtimesUpsert(projectPath: string, runtimes: RuntimeRequirement[]): void {
    const projectId = this.projectIdByPath(projectPath);
    if (!projectId) {
      throw new Error(`Project not found: ${projectPath}`);
    }

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO project_runtimes
        (project_id, language, version_constraint, installed_version, specified_in)
      VALUES (?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction((items: RuntimeRequirement[]) => {
      for (const r of items) {
        insert.run(projectId, r.language, r.constraint, null, r.specified_in);
      }
    });

    tx(runtimes);
  }

  // ========== 项目依赖 ==========

  dependenciesGet(projectPath: string): Dependency[] {
    const projectId = this.projectIdByPath(projectPath);
    if (!projectId) return [];

    const rows = this.db.prepare(
      'SELECT name, version, dep_type, language FROM project_dependencies WHERE project_id = ?'
    ).all(projectId) as Record<string, unknown>[];

    return rows.map(row => ({
      name: row.name as string,
      version: row.version as string,
      dep_type: row.dep_type as Dependency['dep_type'],
      language: row.language as Dependency['language'],
    } satisfies Dependency));
  }

  dependenciesUpsert(projectPath: string, dependencies: Dependency[]): void {
    const projectId = this.projectIdByPath(projectPath);
    if (!projectId) {
      throw new Error(`Project not found: ${projectPath}`);
    }

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO project_dependencies
        (project_id, name, version, dep_type, language)
      VALUES (?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction((items: Dependency[]) => {
      for (const d of items) {
        insert.run(projectId, d.name, d.version, d.dep_type, d.language);
      }
    });

    tx(dependencies);
  }

  // ========== 偏好 ==========

  prefGet(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM preferences WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  prefSet(key: string, value: unknown): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)'
    ).run(key, JSON.stringify(value));
  }

  prefDelete(key: string): void {
    this.db.prepare('DELETE FROM preferences WHERE key = ?').run(key);
  }

  // ========== 查询历史 ==========

  historyRecord(entry: QueryHistoryEntry): void {
    this.db.prepare(`
      INSERT INTO query_history (raw_text, intent_type, entities, context_file, context_symbol, confidence, latency_ms, result_count, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.raw_text,
      entry.intent_type ?? null,
      entry.entities ? JSON.stringify(entry.entities) : null,
      entry.context_file ?? null,
      entry.context_symbol ?? null,
      entry.confidence ?? null,
      entry.latency_ms,
      entry.result_count,
      entry.timestamp ?? new Date().toISOString(),
    );
  }

  historyRecent(limit: number): QueryHistoryEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM query_history ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as Record<string, unknown>[];
    return rows.map(row => ({
      raw_text: row.raw_text as string,
      intent_type: row.intent_type as string | undefined,
      entities: row.entities ? JSON.parse(row.entities as string) : undefined,
      context_file: row.context_file as string | undefined,
      context_symbol: row.context_symbol as string | undefined,
      confidence: row.confidence as number | undefined,
      latency_ms: row.latency_ms as number,
      result_count: row.result_count as number,
      timestamp: row.timestamp as string,
    }));
  }

  historyCleanup(beforeDate?: string): number {
    const cutoff = beforeDate ?? this.daysAgoIso(90);
    const result = this.db.prepare(
      "DELETE FROM query_history WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }

  private daysAgoIso(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }

  // ========== 生命周期 ==========

  close(): void {
    this.db.close();
  }

  // ========== 内部辅助 ==========

  private rowToSymbol(row: Record<string, unknown>): Symbol {
    return {
      id: row.id as string,
      name: row.name as string,
      kind: row.kind as SymbolKind,
      language: row.language as Symbol['language'],
      location: {
        file_path: row.file_path as string,
        line_start: row.line_start as number,
        line_end: row.line_end as number,
        col_start: row.col_start as number,
        col_end: row.col_end as number,
      },
      parent_id: row.parent_id as string | undefined,
      is_exported: !!(row.is_exported as number),
      signature: row.signature as string | undefined,
      doc_comment: row.doc_comment as string | undefined,
    };
  }

  private rowToRef(row: Record<string, unknown>): Reference {
    return {
      id: row.id as string,
      source_symbol_id: row.source_symbol_id as string,
      target_symbol_id: row.target_symbol_id as string,
      location: {
        file_path: row.file_path as string,
        line_start: row.line as number,
        line_end: row.line as number,
        col_start: row.col as number,
        col_end: row.col as number,
      },
      kind: row.kind as Reference['kind'],
    };
  }
}
