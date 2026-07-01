// ============================================================
// Code Intelligence 集成测试 — TC-IT-CI-KS-001~004
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { CodeIntelligenceImpl } from './code-intelligence.impl.js';
import { GitIntelligenceImpl } from '../git-intel/git-intelligence.impl.js';
import type { CodeIntelligence } from './code-intelligence.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';

const FIXTURE_DIR = join(import.meta.dirname!, '..', '..', 'tests', 'fixtures', 'tiny-project');

describe('CodeIntelligence Integration', () => {
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeAll(async () => {
    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(FIXTURE_DIR, ['typescript']);
  });

  // TC-IT-CI-KS-001: 索引 → 存储 → 查询 完整链路
  it('should index project and find symbols', async () => {
    const syms = await ci.findSymbol('refundOrder');
    expect(syms.length).toBeGreaterThanOrEqual(1);
    const fn = syms.find(s => s.name === 'refundOrder')!;
    expect(fn).toBeDefined();
    expect(fn.kind).toBe('function');
    expect(fn.is_exported).toBe(true);
  });

  it('should find class with methods', async () => {
    const syms = await ci.findSymbol('PaymentService');
    expect(syms.length).toBeGreaterThanOrEqual(1);
    const cls = syms.find(s => s.name === 'PaymentService')!;
    expect(cls.kind).toBe('class');

    // 类的方法也应该在索引中
    const methods = await ci.findSymbol('processPayment');
    expect(methods.length).toBeGreaterThanOrEqual(1);
    expect(methods[0]!.kind).toBe('method');
  });

  it('should find references after indexing', async () => {
    const syms = await ci.findSymbol('getOrder');
    if (syms.length > 0) {
      const refs = await ci.findReferences(syms[0]!.id);
      // getOrder 被 refundOrder 调用
      expect(refs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should get symbols in file', async () => {
    const syms = await ci.symbolsInFile(join(FIXTURE_DIR, 'src', 'index.ts'));
    expect(syms.length).toBeGreaterThanOrEqual(4);
    const names = syms.map(s => s.name);
    expect(names).toContain('refundOrder');
    expect(names).toContain('getOrder');
    expect(names).toContain('submitRefund');
    expect(names).toContain('logAudit');
  });

  it('should report correct index status', () => {
    const status = ci.indexStatus();
    expect(status.kind).toBe('ready');
    if (status.kind === 'ready') {
      expect(status.symbol_count).toBeGreaterThan(0);
    }
  });

  // query 入口路由测试
  it('should route query intents correctly', async () => {
    // find_definition
    const defResult = await ci.query({
      intentType: 'find_definition',
      confidence: 0.95,
      rawText: 'find refundOrder',
      entities: { symbolName: 'refundOrder' },
    });
    expect(defResult.kind).toBe('symbol_list');
    if (defResult.kind === 'symbol_list') {
      expect(defResult.symbols.length).toBeGreaterThan(0);
    }
  });

  // TC-IT-CI-KS-005: impactAnalysis 应返回直接调用方
  it('should return direct callers in impact analysis', async () => {
    const syms = await ci.findSymbol('submitRefund');
    expect(syms.length).toBeGreaterThanOrEqual(1);
    const submitRefund = syms.find(s => s.name === 'submitRefund')!;

    const report = await ci.impactAnalysis(submitRefund.id);
    expect(report).not.toBeNull();
    expect(report!.directCallers.length).toBeGreaterThanOrEqual(1);
    const callerNames = report!.directCallers.map(s => s.name);
    expect(callerNames).toContain('refundOrder');
  });
});

// TC-IT-CI-KS-006: impactAnalysis 应返回传递调用方
describe('CodeIntelligence Impact Analysis Transitive Callers', () => {
  const tmpDir = join(tmpdir(), `nodus-impact-test-${Date.now()}`);
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeAll(async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'chain.ts'), `
export async function levelA() {
  return levelB();
}

async function levelB() {
  return levelC();
}

async function levelC() {
  return 'done';
}
`);
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'impact-test' }));

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return transitive callers in impact analysis', async () => {
    const syms = await ci.findSymbol('levelC');
    expect(syms.length).toBeGreaterThanOrEqual(1);
    const levelC = syms.find(s => s.name === 'levelC')!;

    const report = await ci.impactAnalysis(levelC.id);
    expect(report).not.toBeNull();

    const directNames = report!.directCallers.map(s => s.name);
    const transitiveNames = report!.transitiveCallers.map(s => s.name);

    expect(directNames).toContain('levelB');
    expect(transitiveNames).toContain('levelA');
  });
});

// TC-IT-CI-KS-007: 跨文件引用解析
describe('CodeIntelligence Cross-File Reference Resolution', () => {
  const tmpDir = join(tmpdir(), `nodus-crossfile-test-${Date.now()}`);
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeAll(async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'utils.ts'), `
export class PaymentService {
  process(amount: number): boolean {
    return amount > 0;
  }
}
`);
    writeFileSync(join(tmpDir, 'src', 'index.ts'), `
import { PaymentService } from './utils';

export function run() {
  const service = new PaymentService();
  return service.process(100);
}
`);
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'crossfile-test' }));

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should resolve cross-file references to exported symbols', async () => {
    const paymentServiceSyms = await ci.findSymbol('PaymentService');
    expect(paymentServiceSyms.length).toBeGreaterThanOrEqual(1);
    const paymentService = paymentServiceSyms.find(s => s.name === 'PaymentService')!;

    const refs = await ci.findReferences(paymentService.id);
    expect(refs.length).toBeGreaterThanOrEqual(1);

    const fromIndex = refs.filter(r => r.location.file_path.includes('index.ts'));
    expect(fromIndex.length).toBeGreaterThanOrEqual(1);

    // 所有引用目标都应解析为 PaymentService 的真实符号 ID
    for (const ref of refs) {
      expect(ref.target_symbol_id).toBe(paymentService.id);
    }
  });
});

// TC-IT-CI-KS-008: changeHistory 符号级变更追踪
describe('CodeIntelligence Change History Symbol Tracking', () => {
  const tmpDir = join(tmpdir(), `nodus-history-test-${Date.now()}`);
  let store: KnowledgeStore;
  let ci: CodeIntelligenceImpl;
  let gitIntel: GitIntelligenceImpl;

  function git(args: string): string {
    return execSync(`git ${args}`, { cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe' }).trim();
  }

  beforeAll(async () => {
    mkdirSync(tmpDir, { recursive: true });
    git('init');
    git('config user.email "test@nodus.dev"');
    git('config user.name "Test User"');

    writeFileSync(join(tmpDir, 'src.ts'), `
function stableFunction() {}
function willChange() { return 1; }
`);
    git('add .');
    git('commit -m "initial"');

    // 修改 willChange 函数体
    writeFileSync(join(tmpDir, 'src.ts'), `
function stableFunction() {}
function willChange() { return 2; }
`);
    git('add .');
    git('commit -m "update willChange"');

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    gitIntel = new GitIntelligenceImpl();
    ci.setGitIntel(gitIntel);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should report changed symbols at symbol level', async () => {
    const records = await ci.changeHistory({ kind: 'file', path: 'src.ts' });
    expect(records.length).toBeGreaterThanOrEqual(1);

    const latest = records[0]!;
    expect(latest.commitMessage).toBe('update willChange');
    const changedNames = latest.changedSymbols.map(s => s.name);
    expect(changedNames).toContain('willChange');
    expect(changedNames).not.toContain('stableFunction');
  });
});
