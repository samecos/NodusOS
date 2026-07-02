// ============================================================
// 数据库迁移系统单元测试 — TC-UT-MIG-001 ~ TC-UT-MIG-004
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrationRunner, MIGRATIONS } from './migrations.js';

describe('MigrationRunner', () => {
  let db: DatabaseType;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `nodus-migration-test-${Date.now()}.db`);
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
  });

  // TC-UT-MIG-001: 新数据库应应用所有迁移
  it('TC-UT-MIG-001: should apply all migrations on fresh database', () => {
    const runner = new MigrationRunner(db);
    const applied = runner.run();

    expect(applied).toBe(MIGRATIONS.length);
    expect(runner.getCurrentVersion()).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);

    // 验证 schema_version 表存在
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).all() as { name: string }[];
    expect(tables).toHaveLength(1);
  });

  // TC-UT-MIG-002: 重复运行不应重复应用
  it('TC-UT-MIG-002: should not reapply migrations', () => {
    const runner = new MigrationRunner(db);
    runner.run();
    const appliedAgain = runner.run();

    expect(appliedAgain).toBe(0);
    expect(runner.getCurrentVersion()).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
  });

  // TC-UT-MIG-003: 迁移应创建核心表
  it('TC-UT-MIG-003: should create core tables', () => {
    const runner = new MigrationRunner(db);
    runner.run();

    const expectedTables = ['symbols', 'refs', 'projects', 'file_index_state', 'query_history', 'session_state'];
    for (const table of expectedTables) {
      const rows = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).all(table) as { name: string }[];
      expect(rows).toHaveLength(1);
    }
  });

  // TC-UT-MIG-004: 应记录每次迁移的版本号与名称
  it('TC-UT-MIG-004: should record migration versions', () => {
    const runner = new MigrationRunner(db);
    runner.run();

    const versions = db.prepare('SELECT version, name FROM schema_version ORDER BY version').all() as {
      version: number;
      name: string;
    }[];

    expect(versions).toHaveLength(MIGRATIONS.length);
    for (let i = 0; i < MIGRATIONS.length; i++) {
      expect(versions[i].version).toBe(MIGRATIONS[i].version);
      expect(versions[i].name).toBe(MIGRATIONS[i].name);
    }
  });
});
