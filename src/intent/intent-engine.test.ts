// ============================================================
// IntentEngine 测试 — TC-UT-IE-001 ~ TC-UT-IE-015
// ============================================================

import { describe, it, expect } from 'vitest';
import { PatternIntentEngine } from './intent-engine.impl.js';
import type { Context, QueryIntent } from './intent-engine.js';

function makeCtx(overrides: Partial<Context> = {}): Context {
  return {
    active_file: null, cursorLine: null, cursorCol: null,
    cursor_symbol: null, selectedCode: null, selectedRange: null,
    recentQueries: [], activeProjectRoot: '/test',
    ...overrides,
  };
}

function parse(text: string, ctx?: Context): QueryIntent | { kind: string } {
  const engine = new PatternIntentEngine();
  const result = engine.parse({ source: 'text', text, locale: 'zh-CN' }, ctx ?? makeCtx());
  return result as QueryIntent;
}

describe('IntentEngine', () => {
  const engine = new PatternIntentEngine();

  // TC-UT-IE-001: 定义定位
  it('should recognize find_definition intent (zh)', () => {
    const result = parse('getUserByEmail在哪里定义的');
    expect('intentType' in result && result.intentType).toBe('find_definition');
    expect('entities' in result && result.entities?.symbolName).toBe('getUserByEmail');
  });

  // TC-UT-IE-002: 定义定位 (en)
  it('should recognize find_definition intent (en)', () => {
    const result = parse('where is refundOrder defined');
    expect('intentType' in result && result.intentType).toBe('find_definition');
  });

  // TC-UT-IE-003: 引用查找
  it('should recognize find_references intent', () => {
    const result = parse('refundOrder被哪些地方调用了');
    expect('intentType' in result && result.intentType).toBe('find_references');
  });

  // TC-UT-IE-004: 调用链路
  it('should recognize call_graph intent', () => {
    const result = parse('login接口的调用链路是什么样的');
    expect('intentType' in result && result.intentType).toBe('call_graph');
  });

  // TC-UT-IE-005: 影响分析
  it('should recognize impact_analysis intent', () => {
    const result = parse('如果我改了User模型，哪些文件会受影响');
    expect('intentType' in result && result.intentType).toBe('impact_analysis');
  });

  // TC-UT-IE-006: 变更历史
  it('should recognize change_history intent', () => {
    const result = parse('auth模块最近一周改了什么');
    expect('intentType' in result && result.intentType).toBe('change_history');
  });

  // TC-UT-IE-007: 符号概览
  it('should recognize symbol_overview intent', () => {
    const ctx = makeCtx({ active_file: 'payment.service.ts' });
    const result = parse('payment.service.ts里有哪些导出函数', ctx);
    expect('intentType' in result && result.intentType).toBe('symbol_overview');
  });

  // TC-UT-IE-008: 上下文自动补全
  it('should use cursor context when symbol not in text', () => {
    const ctx = makeCtx({ cursor_symbol: 'refundOrder' });
    const result = parse('这个函数被哪里调用了', ctx);
    if ('intentType' in result) {
      expect(result.entities?.symbolName).toBe('refundOrder');
    }
  });

  // TC-UT-IE-012: 空输入
  it('should return empty_input for blank text', () => {
    const result = engine.parse({ source: 'text', text: '', locale: 'zh-CN' }, makeCtx());
    expect('kind' in result && result.kind).toBe('empty_input');
  });

  // TC-UT-IE-014: resolve_ambiguity
  it('should resolve ambiguity by index', () => {
    const candidates = [
      { rawText: 'a', intentType: 'find_definition' as const, confidence: 0.5, entities: {} },
      { rawText: 'b', intentType: 'find_references' as const, confidence: 0.5, entities: {} },
    ];
    const resolved = engine.resolveAmbiguity(candidates, 1);
    expect(resolved.intentType).toBe('find_references');
  });
});
