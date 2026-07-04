// ============================================================
// QueryCache 单元测试 — TC-UT-QC-001 ~ TC-UT-QC-002
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryCache } from './query-cache.js';
import type { Context } from '../context/context-manager.js';

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

describe('QueryCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // TC-UT-QC-001: 基础 set/get/clear/expire
  it('TC-UT-QC-001: should set, get, clear, and expire entries', () => {
    const cache = new QueryCache(5, 1000);

    cache.set('key1', 'result1');
    expect(cache.get('key1')).toBe('result1');
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('key1')).toBeNull();

    // 过期测试
    cache.set('key2', 'result2');
    vi.advanceTimersByTime(1001);
    expect(cache.get('key2')).toBeNull();
  });

  // TC-UT-QC-001b: LRU 淘汰
  it('TC-UT-QC-001b: should evict oldest entry when exceeding maxSize', () => {
    const cache = new QueryCache(3);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    expect(cache.size).toBe(3);

    cache.set('d', '4'); // 淘汰 'a'
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('d')).toBe('4');
  });

  // TC-UT-QC-002: buildKey 上下文感知
  it('TC-UT-QC-002: buildKey should reflect text and context', () => {
    const ctx1 = makeContext({ active_file: 'src/a.ts', cursor_symbol: 'foo' });
    const ctx2 = makeContext({ active_file: 'src/b.ts', cursor_symbol: 'bar' });

    const key1 = QueryCache.buildKey('Hello World', ctx1);
    const key2 = QueryCache.buildKey('hello world', ctx1); // 大小写不敏感
    const key3 = QueryCache.buildKey('Hello World', ctx2); // 不同上下文

    expect(key1).toBe(key2);     // 相同文本 + 相同上下文
    expect(key1).not.toBe(key3); // 不同上下文 → 不同 key
    expect(key1).toContain('foo');
    expect(key1).toContain('src/a.ts');
  });

  // TC-UT-QC-002b: 无上下文时 key 仍可用
  it('TC-UT-QC-002b: buildKey should work with null context', () => {
    const ctx = makeContext();
    const key = QueryCache.buildKey('test', ctx);
    expect(key).toBe('test|:');
  });
});
