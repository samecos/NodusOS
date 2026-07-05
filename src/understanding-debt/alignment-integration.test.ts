import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../store/migrations.js';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { GitIntelligenceImpl } from '../git-intel/git-intelligence.impl.js';
import { DefaultChangeSensor } from '../change-sensor/change-sensor.impl.js';
import { DebtEngineImpl } from '../understanding-debt/debt-engine.impl.js';
import { SemanticChunkerImpl } from '../semantic-chunk/semantic-chunker.impl.js';
import { AlignmentFlywheelImpl } from '../alignment/alignment-flywheel.impl.js';
import { NodusMdEmitter } from '../alignment/emitters/nodus-md-emitter.js';
import { renderAnnotatedView } from '../overlay/annotated-view.js';

describe('理解层端到端集成测试', () => {
  let projectRoot: string;
  let dbPath: string;
  let store: SqliteKnowledgeStore;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'nodus-e2e-'));
    execSync('git init && git config user.email t@t.com && git config user.name t', { cwd: projectRoot, stdio: 'pipe' });
    writeFileSync(join(projectRoot, 'payment.ts'), 'export function charge(amount: number) {\n  return amount;\n}\n');
    execSync('git add -A && git commit -m init', { cwd: projectRoot, stdio: 'pipe' });

    dbPath = join(tmpdir(), `nodus-e2e-${Date.now()}.db`);
    const db = new Database(dbPath);
    new MigrationRunner(db).run();
    db.close();
    store = new SqliteKnowledgeStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dbPath, { force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // TC-IT-E2E-001: 端到端旅程 — spec 8.1
  it('TC-IT-E2E-001: should run full alignment pipeline', async () => {
    // 1. 模拟 AI 改文件
    writeFileSync(join(projectRoot, 'payment.ts'),
      'export function charge(amount: number) {\n  const result = service.pay(amount);\n  return result;\n}\n');

    // 2. ChangeSensor 检测
    const sensor = new DefaultChangeSensor(new GitIntelligenceImpl());
    const batch = await sensor.detect(projectRoot);
    expect(batch).not.toBeNull();
    expect(batch!.files).toContain('payment.ts');

    // 3. DebtEngine 重算
    const debtEngine = new DebtEngineImpl(store);
    await debtEngine.recompute(batch!);
    const topDebts = debtEngine.getTopDebt(10);
    expect(topDebts.length).toBeGreaterThan(0);
    expect(topDebts[0]!.debt).toBeGreaterThan(0);
    // P1 难度启发式：blastRadius 固定 0.5，单次新鲜变更 difficulty≤0.75 → debt<1（green）
    // 故不强制 red/yellow；此处仅验证债值被真实计算并被后续 confirm 清零。

    // 4. SemanticChunker 聚类 + 简报
    const chunker = new SemanticChunkerImpl();
    const chunks = chunker.chunk(batch!);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const briefs = chunks.map(c => chunker.brief(c, batch!));
    expect(briefs[0]!.title).toBeDefined();

    // 5. 渲染 AnnotatedView
    const debts = debtEngine.getDebtByFile('payment.ts');
    const view = renderAnnotatedView('payment.ts', batch!.snapshot['payment.ts']!, debts, briefs);
    expect(view).toContain('charge');

    // 6. 确认审查 → 债值清零
    const symbolId = topDebts[0]!.symbol_id;
    debtEngine.confirmReviewed(symbolId);
    const afterConfirm = debtEngine.getTopDebt(10).find(d => d.symbol_id === symbolId);
    expect(afterConfirm!.debt).toBe(0);
    expect(afterConfirm!.confirmed).toBe(true);

    // 7. 修正捕获 → conventions 入库
    const flywheel = new AlignmentFlywheelImpl(store, [new NodusMdEmitter()]);
    flywheel.capture({
      snapshot: 'const result = service.pay(amount);\n  return result;',
      after: 'const result = service.pay(amount);\n  if (!result) return null;\n  return result;',
      symbols_involved: ['payment.ts:charge'],
      chunk_id: chunks[0]!.id,
      brief_field_hits: ['impact_radius', 'complexity_hotspots'],
      action: 'pass',
      debt_at_review: topDebts[0]!.debt,
    });

    const annotations = store.codeAnnotationList();
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.annotation_tags).toContain('add_null_check');

    const conventions = store.conventionList();
    expect(conventions.some(c => c.tag === 'add_null_check')).toBe(true);

    // 8. 发射 conventions.md
    flywheel.emitConventions(projectRoot);
    const mdPath = join(projectRoot, '.nodus', 'conventions.md');
    expect(existsSync(mdPath)).toBe(true);
    const mdContent = readFileSync(mdPath, 'utf-8');
    expect(mdContent).toContain('add_null_check');
    expect(mdContent).toContain('charge');
  });
});
