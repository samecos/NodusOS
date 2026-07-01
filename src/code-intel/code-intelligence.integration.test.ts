// ============================================================
// Code Intelligence 集成测试 — TC-IT-CI-KS-001~004
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { CodeIntelligenceImpl } from './code-intelligence.impl.js';
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
});
