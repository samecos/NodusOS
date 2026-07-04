// ============================================================
// RecommendationEngine 单元测试 — TC-UT-RE-001 ~ TC-UT-RE-004
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { RecommendationEngine } from './recommendation-engine.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { ContextManager, Context } from '../context/context-manager.js';
import type { QueryHistoryEntry } from '../common/types.js';

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    active_file: null,
    cursor_line: null,
    cursor_col: null,
    cursor_symbol: null,
    selected_code: null,
    selected_range: null,
    recent_queries: [],
    active_project_root: '/',
    ...overrides,
  };
}

function mockStore(history: QueryHistoryEntry[] = []): KnowledgeStore {
  return {
    historyRecent: vi.fn((limit: number) => history.slice(0, limit)),
  } as unknown as KnowledgeStore;
}

function mockContextMgr(ctx: Context): ContextManager {
  return {
    snapshot: vi.fn(() => ctx),
  } as unknown as ContextManager;
}

describe('RecommendationEngine', () => {
  // TC-UT-RE-001: 上下文存在 cursor_symbol 时应生成推荐
  it('TC-UT-RE-001: should generate context-based recommendations', () => {
    const ctx = makeContext({ cursor_symbol: 'refundOrder' });
    const engine = new RecommendationEngine(mockStore(), mockContextMgr(ctx));
    const recs = engine.generate();

    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some(r => r.text.includes('refundOrder'))).toBe(true);
    expect(recs.some(r => r.text.includes('调用'))).toBe(true);
    expect(recs.some(r => r.text.includes('影响'))).toBe(true);
  });

  // TC-UT-RE-002: 高频查询应出现在推荐中
  it('TC-UT-RE-002: should recommend frequent queries', () => {
    const history: QueryHistoryEntry[] = [
      { raw_text: '项目代码统计', intent_type: 'stats', timestamp: '2026-07-01T10:00:00Z', latency_ms: 10, result_count: 4 },
      { raw_text: '项目代码统计', intent_type: 'stats', timestamp: '2026-07-01T11:00:00Z', latency_ms: 8, result_count: 4 },
      { raw_text: 'refundOrder在哪里定义的', intent_type: 'find_definition', timestamp: '2026-07-01T12:00:00Z', latency_ms: 15, result_count: 1 },
    ];
    const ctx = makeContext(); // 无 cursor_symbol
    const engine = new RecommendationEngine(mockStore(history), mockContextMgr(ctx));
    const recs = engine.generate();

    expect(recs.some(r => r.text === '项目代码统计')).toBe(true);
  });

  // TC-UT-RE-003: 空上下文 + 空历史应返回空列表降级
  it('TC-UT-RE-003: should return empty list when no context and no history', () => {
    const ctx = makeContext();
    const engine = new RecommendationEngine(mockStore([]), mockContextMgr(ctx));
    const recs = engine.generate();

    expect(recs).toEqual([]);
  });

  // TC-UT-RE-004: 推荐应去重并截断为 ≤ 3 条
  it('TC-UT-RE-004: should deduplicate and cap at 3 recommendations', () => {
    // cursor_symbol 生成 2 条 + 高频查询 2 条 + 延续 1 条 = 5 条候选
    // 但高频查询中有一条跟上下文推荐重复 → 去重后 ≤ 4 → 截断为 3
    const history: QueryHistoryEntry[] = [
      { raw_text: 'refundOrder被哪些地方调用了', intent_type: 'find_references', timestamp: '2026-07-01T10:00:00Z', latency_ms: 10, result_count: 5 },
      { raw_text: 'refundOrder被哪些地方调用了', intent_type: 'find_references', timestamp: '2026-07-01T11:00:00Z', latency_ms: 12, result_count: 5 },
      { raw_text: 'PaymentService里有哪些函数', intent_type: 'symbol_overview', timestamp: '2026-07-01T12:00:00Z', latency_ms: 8, result_count: 3 },
      { raw_text: 'PaymentService里有哪些函数', intent_type: 'symbol_overview', timestamp: '2026-07-01T13:00:00Z', latency_ms: 9, result_count: 3 },
    ];
    const ctx = makeContext({
      cursor_symbol: 'refundOrder',
      recent_queries: [
        { text: 'refundOrder在哪里定义的', intent_type: 'find_definition', timestamp: '2026-07-01T14:00:00Z' },
      ],
    });
    const engine = new RecommendationEngine(mockStore(history), mockContextMgr(ctx));
    const recs = engine.generate();

    expect(recs.length).toBeLessThanOrEqual(3);
    // 去重检查：不应有重复 text
    const texts = recs.map(r => r.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});
