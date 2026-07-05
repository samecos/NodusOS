// ============================================================
// TeamCollaboration 测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { TeamCollaborationImpl } from './team-collaboration.impl.js';
import type { Symbol, Reference, ProjectMeta } from '../common/types.js';

describe('TeamCollaboration', () => {
  let tmpDir: string;
  let dbPath: string;
  let store: SqliteKnowledgeStore;
  let collab: TeamCollaborationImpl;
  let annotationsPath: string;

  let projectPath: string;
  let projectMeta: ProjectMeta;
  let sampleSymbol: Symbol;
  let sampleRef: Reference;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nodus-collab-test-'));
    dbPath = join(tmpDir, 'test.db');
    annotationsPath = join(tmpDir, 'annotations.json');
    store = new SqliteKnowledgeStore(dbPath);
    collab = new TeamCollaborationImpl(annotationsPath);

    projectPath = join(tmpDir, 'project');
    projectMeta = {
      name: 'test-project',
      root_path: projectPath,
      languages: ['typescript'],
      runtimes: [],
      dependencies: [],
    };

    sampleSymbol = {
      id: 'sym-1',
      name: 'foo',
      kind: 'function',
      language: 'typescript',
      location: {
        file_path: join(projectPath, 'src', 'index.ts'),
        line_start: 1,
        line_end: 3,
        col_start: 0,
        col_end: 15,
      },
      is_exported: true,
      signature: 'function foo(): void',
    };

    sampleRef = {
      id: 'ref-1',
      source_symbol_id: 'sym-2',
      target_symbol_id: 'sym-1',
      location: {
        file_path: join(projectPath, 'src', 'index.ts'),
        line_start: 5,
        line_end: 5,
        col_start: 0,
        col_end: 3,
      },
      kind: 'call',
    };
  });

  afterEach(() => {
    store.close();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  // ---- TC-UT-COLLAB-001: shareIndex ----

  it('TC-UT-COLLAB-001: should export project index as JSON', async () => {
    store.projectUpsertFull(projectMeta);
    store.symbolsUpsert([sampleSymbol]);
    store.refsUpsert([sampleRef]);

    const json = await collab.shareIndex(projectPath, store);
    const shared = JSON.parse(json) as Record<string, unknown>;

    expect(shared.version).toBe('1.0');
    expect((shared.project_meta as ProjectMeta).name).toBe('test-project');
    expect((shared.symbols as Symbol[])).toHaveLength(1);
    expect((shared.symbols as Symbol[])[0]!.id).toBe('sym-1');
    expect((shared.references as Reference[])).toHaveLength(1);
  });

  it('TC-UT-COLLAB-002: should throw when project not indexed', async () => {
    await expect(collab.shareIndex('/nonexistent', store)).rejects.toThrow();
  });

  // ---- TC-UT-COLLAB-003: importSharedIndex ----

  it('TC-UT-COLLAB-003: should import shared index JSON', async () => {
    const sharedJson = JSON.stringify({
      version: '1.0',
      exported_at: new Date().toISOString(),
      project_meta: projectMeta,
      symbols: [sampleSymbol],
      references: [sampleRef],
      annotations: [
        {
          id: 'ann-1',
          symbol_id: 'sym-1',
          content: 'Team note',
          author: 'dev1',
          created_at: '2024-01-01T00:00:00Z',
          tags: ['review'],
        },
      ],
    });

    const stats = await collab.importSharedIndex(sharedJson, store);
    expect(stats.symbols).toBe(1);
    expect(stats.references).toBe(1);
    expect(stats.annotations).toBe(1);

    const found = store.symbolsFindById('sym-1');
    expect(found).toBeDefined();
    expect(found?.name).toBe('foo');
  });

  it('TC-UT-COLLAB-004: should reject invalid JSON', async () => {
    await expect(collab.importSharedIndex('not-json', store)).rejects.toThrow();
  });

  // ---- TC-UT-COLLAB-005: addAnnotation / listAnnotations ----

  it('TC-UT-COLLAB-005: should add and list annotations', async () => {
    const ann = await collab.addAnnotation({
      symbol_id: 'sym-1',
      content: 'Important function',
      author: 'alice',
      tags: ['critical'],
    });

    expect(ann.id).toBeTruthy();
    expect(ann.created_at).toBeTruthy();
    expect(ann.content).toBe('Important function');

    const all = await collab.listAnnotations();
    expect(all).toHaveLength(1);

    const filtered = await collab.listAnnotations('sym-1');
    expect(filtered).toHaveLength(1);

    const empty = await collab.listAnnotations('sym-999');
    expect(empty).toHaveLength(0);
  });

  // ---- TC-UT-COLLAB-006: exportTeamKnowledge ----

  it('TC-UT-COLLAB-006: should export team knowledge with annotations', async () => {
    store.projectUpsertFull(projectMeta);
    store.symbolsUpsert([sampleSymbol]);

    await collab.addAnnotation({
      symbol_id: 'sym-1',
      content: 'Team knowledge note',
      author: 'bob',
    });

    // 添加一个不属于项目的注释
    await collab.addAnnotation({
      symbol_id: 'sym-999',
      content: 'Orphan note',
      author: 'bob',
    });

    const json = await collab.exportTeamKnowledge(projectPath, store);
    const shared = JSON.parse(json) as Record<string, unknown>;

    expect((shared.symbols as Symbol[])).toHaveLength(1);
    expect((shared.annotations as unknown[])).toHaveLength(1);
    expect((shared.annotations as Array<{ content: string }>)[0]!.content).toBe('Team knowledge note');
  });

  // ---- TC-UT-COLLAB-007: idempotency on re-import ----

  it('TC-UT-COLLAB-007: should not duplicate annotations on re-import', async () => {
    const shared = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      project_meta: projectMeta,
      symbols: [sampleSymbol],
      references: [],
      annotations: [
        {
          id: 'ann-dup',
          symbol_id: 'sym-1',
          content: 'Dup',
          author: 'dev',
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    };

    await collab.importSharedIndex(JSON.stringify(shared), store);
    await collab.importSharedIndex(JSON.stringify(shared), store);

    const anns = await collab.listAnnotations();
    expect(anns).toHaveLength(1);
  });
});
