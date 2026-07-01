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
} from '../common/types.js';
import type { KnowledgeStore } from './knowledge-store.js';

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS symbols (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    language TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    col_start INTEGER NOT NULL,
    col_end INTEGER NOT NULL,
    parent_id TEXT,
    is_exported INTEGER NOT NULL DEFAULT 0,
    signature TEXT,
    doc_comment TEXT,
    file_checksum TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS refs (
    id TEXT PRIMARY KEY,
    source_symbol_id TEXT NOT NULL,
    target_symbol_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line INTEGER NOT NULL,
    col INTEGER NOT NULL,
    kind TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS callgraphs (
    symbol_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    max_depth INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol_id, direction, max_depth)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    languages TEXT NOT NULL,
    runtimes TEXT NOT NULL DEFAULT '[]',
    package_manager TEXT,
    dependencies TEXT NOT NULL DEFAULT '[]',
    framework TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS query_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_text TEXT NOT NULL,
    intent_type TEXT,
    entities TEXT,
    context_file TEXT,
    context_symbol TEXT,
    confidence REAL,
    latency_ms INTEGER,
    result_count INTEGER,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
  CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
  CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
  CREATE INDEX IF NOT EXISTS idx_refs_target ON refs(target_symbol_id);
  CREATE INDEX IF NOT EXISTS idx_refs_source ON refs(source_symbol_id);
  CREATE INDEX IF NOT EXISTS idx_refs_file ON refs(file_path);
  CREATE INDEX IF NOT EXISTS idx_query_hist_time ON query_history(timestamp);
`;

export class SqliteKnowledgeStore implements KnowledgeStore {
  private db: DatabaseType;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
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
      INSERT INTO query_history (raw_text, intent_type, entities, context_file, context_symbol, confidence, latency_ms, result_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.raw_text,
      entry.intent_type ?? null,
      entry.entities ? JSON.stringify(entry.entities) : null,
      entry.context_file ?? null,
      entry.context_symbol ?? null,
      entry.confidence ?? null,
      entry.latency_ms,
      entry.result_count,
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
