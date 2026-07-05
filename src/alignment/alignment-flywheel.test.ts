import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { NodusMdEmitter } from './emitters/nodus-md-emitter.js';
import type { Convention } from '../common/types.js';
import { MigrationRunner } from '../store/migrations.js';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { AlignmentFlywheelImpl } from './alignment-flywheel.impl.js';

describe('NodusMdEmitter', () => {
  // TC-UT-AF-001: 渲染非空约定列表
  it('TC-UT-AF-001: should render conventions list', () => {
    const emitter = new NodusMdEmitter();
    const conventions: Convention[] = [
      { tag: 'add_null_check', pattern_desc: '调用外部服务后未判空', occurrences: 5, symbol_examples: 'PaymentService.charge', last_seen: Date.now() },
      { tag: 'add_type', pattern_desc: '函数参数未标注类型', occurrences: 3, symbol_examples: null, last_seen: Date.now() },
    ];
    const output = emitter.render(conventions);
    expect(output).toContain('add_null_check');
    expect(output).toContain('出现 5 次');
    expect(output).toContain('PaymentService.charge');
    expect(output).toContain('add_type');
  });

  // TC-UT-AF-002: 空列表渲染占位
  it('TC-UT-AF-002: should render placeholder for empty list', () => {
    const emitter = new NodusMdEmitter();
    const output = emitter.render([]);
    expect(output).toContain('暂无');
  });
});

describe('AlignmentFlywheelImpl', () => {
  let dbPath: string;
  let store: SqliteKnowledgeStore;
  let projectRoot: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `nodus-flywheel-test-${Date.now()}.db`);
    const db = new Database(dbPath);
    new MigrationRunner(db).run();
    db.close();
    store = new SqliteKnowledgeStore(dbPath);
    projectRoot = mkdtempSync(join(tmpdir(), 'nodus-flywheel-proj-'));
  });

  afterEach(() => {
    store.close();
    rmSync(dbPath, { force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // TC-UT-AF-010: capture 应写 code_annotations + 累计 convention
  it('TC-UT-AF-010: capture should record annotation and increment convention', () => {
    const flywheel = new AlignmentFlywheelImpl(store, [new NodusMdEmitter()]);
    flywheel.capture({
      snapshot: 'const result = service.call();\nreturn result;',
      after: 'const result = service.call();\nif (!result) return null;\nreturn result;',
      symbols_involved: ['sym-1'],
      chunk_id: 'chunk-1',
      brief_field_hits: ['impact_radius'],
      action: 'pass',
      debt_at_review: 3.2,
    });
    const annotations = store.codeAnnotationList();
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.annotation_tags).toContain('add_null_check');

    const conventions = store.conventionList();
    expect(conventions.some(c => c.tag === 'add_null_check')).toBe(true);
  });

  // TC-UT-AF-011: emitConventions 应写 .nodus/conventions.md
  it('TC-UT-AF-011: emitConventions should write conventions.md', () => {
    const flywheel = new AlignmentFlywheelImpl(store, [new NodusMdEmitter()]);
    flywheel.capture({
      snapshot: 'const x = f();',
      after: 'if (!f()) return;\nconst x = f();',
      symbols_involved: ['sym-2'],
      chunk_id: null, brief_field_hits: [], action: 'dig', debt_at_review: 2.0,
    });
    flywheel.emitConventions(projectRoot);
    const mdPath = join(projectRoot, '.nodus', 'conventions.md');
    expect(existsSync(mdPath)).toBe(true);
    const content = readFileSync(mdPath, 'utf-8');
    expect(content).toContain('add_null_check');
  });

  // TC-UT-AF-012: prune 应删除约定
  it('TC-UT-AF-012: prune should delete convention', () => {
    const flywheel = new AlignmentFlywheelImpl(store, [new NodusMdEmitter()]);
    flywheel.capture({
      snapshot: 'const x = f();', after: 'if (!f()) return;\nconst x = f();',
      symbols_involved: ['sym-3'], chunk_id: null, brief_field_hits: [],
      action: 'pass', debt_at_review: 1.0,
    });
    expect(flywheel.prune('add_null_check')).toBe(true);
    expect(flywheel.listConventions().find(c => c.tag === 'add_null_check')).toBeUndefined();
  });
});
