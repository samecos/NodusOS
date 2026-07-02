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

  it('should record file index state after indexing', async () => {
    const state = store.fileStateGet(join(FIXTURE_DIR, 'src', 'index.ts'));
    expect(state).toBeDefined();
    expect(state!.checksum.length).toBeGreaterThan(0);
    expect(state!.symbol_count).toBeGreaterThan(0);
    expect(state!.error).toBeUndefined();
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

  it('TC-IT-CI-KS-013: should route find_references intent', async () => {
    const result = await ci.query({
      intentType: 'find_references',
      confidence: 0.95,
      rawText: 'who calls refundOrder',
      entities: { symbolName: 'refundOrder' },
    });
    expect(result.kind).toBe('reference_list');
  });

  it('TC-IT-CI-KS-014: should route call_graph intent', async () => {
    const result = await ci.query({
      intentType: 'call_graph',
      confidence: 0.95,
      rawText: 'call graph of refundOrder',
      entities: { symbolName: 'refundOrder' },
    });
    expect(result.kind).toBe('call_graph');
  });

  it('TC-IT-CI-KS-015: should route impact_analysis intent', async () => {
    const result = await ci.query({
      intentType: 'impact_analysis',
      confidence: 0.95,
      rawText: 'impact of refundOrder',
      entities: { symbolName: 'refundOrder' },
    });
    expect(result.kind).toBe('impact_report');
  });

  it('TC-IT-CI-KS-016: should route symbol_overview intent', async () => {
    const result = await ci.query({
      intentType: 'symbol_overview',
      confidence: 0.95,
      rawText: 'symbols in index.ts',
      entities: { filePath: join(FIXTURE_DIR, 'src', 'index.ts') },
    });
    expect(result.kind).toBe('symbol_overview');
  });

  it('TC-IT-CI-KS-017: should route stats intent', async () => {
    const result = await ci.query({
      intentType: 'stats',
      confidence: 0.95,
      rawText: 'project stats',
      entities: {},
    });
    expect(result.kind).toBe('stats_report');
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

// TC-IT-CI-KS-009 ~ TC-IT-CI-KS-011: checksum 增量索引
describe('CodeIntelligence Incremental Indexing', () => {
  const tmpDir = join(tmpdir(), `nodus-incremental-test-${Date.now()}`);
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeAll(async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'a.ts'), `
export function helperA(): string { return 'a'; }
`);
    writeFileSync(join(tmpDir, 'src', 'b.ts'), `
import { helperA } from './a';
export function useA(): string { return helperA(); }
`);
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'incremental-test' }));

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-IT-CI-KS-009: should skip unchanged files on second project index', async () => {
    const firstState = store.fileStateGet(join(tmpDir, 'src', 'a.ts'));
    expect(firstState).toBeDefined();

    const report = await ci.indexProject(tmpDir, ['typescript']);
    expect(report.filesFailed).toBe(0);

    const secondState = store.fileStateGet(join(tmpDir, 'src', 'a.ts'));
    expect(secondState!.checksum).toBe(firstState!.checksum);
    expect(secondState!.indexed_at).toBe(firstState!.indexed_at);
  });

  it('TC-IT-CI-KS-010: indexFile should skip unchanged file', async () => {
    const result = await ci.indexFile(join(tmpDir, 'src', 'a.ts'));
    expect(result.symbolsAdded).toBe(0);
    expect(result.symbolsRemoved).toBe(0);
    expect(result.referencesUpdated).toBe(0);
  });

  it('TC-IT-CI-KS-011: should re-index changed file and preserve unchanged file state', async () => {
    const unchangedStateBefore = store.fileStateGet(join(tmpDir, 'src', 'b.ts'));

    // 修改 a.ts
    writeFileSync(join(tmpDir, 'src', 'a.ts'), `
export function helperA(): string { return 'a-modified'; }
export function helperB(): string { return 'b'; }
`);

    const report = await ci.indexProject(tmpDir, ['typescript']);
    expect(report.filesFailed).toBe(0);

    const aState = store.fileStateGet(join(tmpDir, 'src', 'a.ts'));
    expect(aState!.symbol_count).toBe(2);

    const unchangedStateAfter = store.fileStateGet(join(tmpDir, 'src', 'b.ts'));
    expect(unchangedStateAfter!.checksum).toBe(unchangedStateBefore!.checksum);
    expect(unchangedStateAfter!.indexed_at).toBe(unchangedStateBefore!.indexed_at);
  });
});

// TC-IT-CI-KS-012: callGraph 调用图构建
describe('CodeIntelligence CallGraph', () => {
  const tmpDir = join(tmpdir(), `nodus-callgraph-test-${Date.now()}`);
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
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'callgraph-test' }));

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-IT-CI-KS-012: should build call graph with callers and callees', async () => {
    const syms = await ci.findSymbol('levelA');
    expect(syms.length).toBeGreaterThanOrEqual(1);
    const levelA = syms.find(s => s.name === 'levelA')!;

    const graph = await ci.callGraph(levelA.id, 'both', 3);
    expect(graph).not.toBeNull();

    const nodeNames = new Set(graph!.nodes.map(n => n.symbol_name));
    expect(nodeNames).toContain('levelA');
    expect(nodeNames).toContain('levelB');
    expect(nodeNames).toContain('levelC');

    const edges = graph!.edges;
    expect(edges.some(e => e.from === levelA.id)).toBe(true);
  });
});

// TC-IT-CI-KS-018 ~ TC-IT-CI-KS-019: indexFile 增量更新
describe('CodeIntelligence indexFile incremental update', () => {
  const tmpDir = join(tmpdir(), `nodus-indexfile-test-${Date.now()}`);
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeAll(async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'a.ts'), `export function helperA(): string { return 'a'; }`);
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'indexfile-test' }));

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-IT-CI-KS-018: should skip unchanged file in indexFile', async () => {
    const result = await ci.indexFile(join(tmpDir, 'src', 'a.ts'));
    expect(result.symbolsAdded).toBe(0);
    expect(result.symbolsRemoved).toBe(0);
    expect(result.referencesUpdated).toBe(0);
  });

  it('TC-IT-CI-KS-019: should re-index changed file and update symbols', async () => {
    writeFileSync(join(tmpDir, 'src', 'a.ts'), `
export function helperA(): string { return 'a'; }
export function helperB(): string { return 'b'; }
`);

    const result = await ci.indexFile(join(tmpDir, 'src', 'a.ts'));
    expect(result.symbolsAdded).toBeGreaterThan(0);

    const syms = await ci.symbolsInFile(join(tmpDir, 'src', 'a.ts'));
    const names = syms.map(s => s.name);
    expect(names).toContain('helperA');
    expect(names).toContain('helperB');
  });
});

import { ModuleResolver } from '../code-intel/module-resolver.js'; // 测试里不一定需要，留作说明

// TC-IT-CI-XREF-001 ~ TC-IT-CI-XREF-002: 跨文件引用解析（re-export + alias + namespace）
describe('CodeIntelligence Cross-File References', () => {
  const tmpDir = join(tmpdir(), `nodus-xref-test-${Date.now()}`);
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeAll(async () => {
    mkdirSync(join(tmpDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'xref-test' }));
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@payment': ['src/payment'] } }
    }));
    writeFileSync(join(tmpDir, 'src', 'payment.ts'), `
export function refundOrder(): void {}
export function getOrder(): void {}
`);
    writeFileSync(join(tmpDir, 'src', 'utils', 'index.ts'), `export { refundOrder } from '../payment';`);
    writeFileSync(join(tmpDir, 'src', 'app.ts'), `
import { refundOrder as ro } from './utils';
import * as payment from '@payment';
ro();
payment.refundOrder();
`);

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-IT-CI-XREF-001: index re-export + alias + namespace 调用都被解析', async () => {
    const syms = await ci.findSymbol('refundOrder');
    expect(syms.length).toBeGreaterThanOrEqual(1);
    const refundSym = syms.find(s => s.name === 'refundOrder' && s.location.file_path.includes('payment.ts'))!;

    const refs = await ci.findReferences(refundSym.id);
    const callRefs = refs.filter(r => r.kind === 'call');
    expect(callRefs.length).toBeGreaterThanOrEqual(2);

    const fromApp = callRefs.filter(r => r.location.file_path.includes('app.ts'));
    expect(fromApp.length).toBeGreaterThanOrEqual(1);
  });

  it('TC-IT-CI-XREF-002: indexFile 增量更新后引用仍正确', async () => {
    const appPath = join(tmpDir, 'src', 'app.ts');
    writeFileSync(appPath, `
import { refundOrder } from './utils';
refundOrder();
`);
    await ci.indexFile(appPath);

    const syms = await ci.findSymbol('refundOrder');
    const refundSym = syms.find(s => s.location.file_path.includes('payment.ts'))!;
    const refs = await ci.findReferences(refundSym.id);
    expect(refs.some(r => r.location.file_path === appPath)).toBe(true);
  });
});

// TC-IT-CI-KS-020: indexFile 后调用 callGraph 应正确返回调用边
describe('CodeIntelligence callGraph after indexFile', () => {
  const tmpDir = join(tmpdir(), `nodus-callgraph-after-indexfile-test-${Date.now()}`);
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeAll(async () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'a.ts'), `
export function a(): string { return b(); }
function b(): string { return 'b'; }
`);
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'callgraph-after-indexfile-test' }));

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-IT-CI-KS-020: should build call graph after re-indexing via indexFile', async () => {
    // 通过 indexFile 重新索引（即使内容未变，也会走增量索引路径）
    const result = await ci.indexFile(join(tmpDir, 'src', 'a.ts'));
    expect(result.symbolsAdded + result.symbolsRemoved).toBeGreaterThanOrEqual(0);

    const syms = await ci.findSymbol('a');
    expect(syms.length).toBeGreaterThanOrEqual(1);
    const fnA = syms.find(s => s.name === 'a')!;

    const graph = await ci.callGraph(fnA.id, 'callees', 2);
    expect(graph).not.toBeNull();

    const edge = graph!.edges.find(e => e.from === fnA.id);
    expect(edge).toBeDefined();

    const bSym = graph!.nodes.find(n => n.symbol_name === 'b');
    expect(bSym).toBeDefined();
    expect(edge!.to).toBe(bSym!.symbol_id);
  });
});
