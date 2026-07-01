// ============================================================
// 数据库迁移系统
// schema_version 表 + 顺序执行的迁移脚本
// ============================================================

import type { Database as DatabaseType } from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

/** 初始 schema — 对应当前 KnowledgeStore 所需全部表结构 */
const INITIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

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

  CREATE TABLE IF NOT EXISTS project_runtimes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    language TEXT NOT NULL,
    version_constraint TEXT NOT NULL,
    installed_version TEXT,
    specified_in TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, language)
  );

  CREATE TABLE IF NOT EXISTS project_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    dep_type TEXT NOT NULL,
    language TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, name, dep_type)
  );

  CREATE TABLE IF NOT EXISTS file_index_state (
    file_path TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    symbol_count INTEGER NOT NULL DEFAULT 0,
    indexed_at TEXT NOT NULL,
    error TEXT
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
  CREATE INDEX IF NOT EXISTS idx_symbols_language ON symbols(language);
  CREATE INDEX IF NOT EXISTS idx_symbols_parent ON symbols(parent_id);
  CREATE INDEX IF NOT EXISTS idx_symbols_file_kind ON symbols(file_path, kind);
  CREATE INDEX IF NOT EXISTS idx_refs_target ON refs(target_symbol_id);
  CREATE INDEX IF NOT EXISTS idx_refs_source ON refs(source_symbol_id);
  CREATE INDEX IF NOT EXISTS idx_refs_file ON refs(file_path);
  CREATE INDEX IF NOT EXISTS idx_refs_kind ON refs(kind);
  CREATE INDEX IF NOT EXISTS idx_file_state_checksum ON file_index_state(checksum);
  CREATE INDEX IF NOT EXISTS idx_query_hist_time ON query_history(timestamp);
  CREATE INDEX IF NOT EXISTS idx_query_hist_intent ON query_history(intent_type);
`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: INITIAL_SCHEMA,
  },
];

export class MigrationRunner {
  constructor(private db: DatabaseType) {}

  /** 运行所有未应用的迁移，返回应用的迁移数量 */
  run(): number {
    this.ensureSchemaVersionTable();

    const currentVersion = this.getCurrentVersion();
    let applied = 0;

    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue;

      this.db.exec(migration.up);
      this.db.prepare(
        'INSERT INTO schema_version (version, name) VALUES (?, ?)'
      ).run(migration.version, migration.name);

      applied++;
    }

    return applied;
  }

  getCurrentVersion(): number {
    this.ensureSchemaVersionTable();
    const row = this.db.prepare(
      'SELECT MAX(version) as version FROM schema_version'
    ).get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  }

  private ensureSchemaVersionTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
}
