// ============================================================
// QueryCache — 查询结果 LRU + TTL 缓存
// 同一查询（规范化文本 + 上下文哈希）在 TTL 窗口内直接返回缓存结果。
// ============================================================

import type { Context } from '../context/context-manager.js';

interface CacheEntry {
  result: string;
  createdAt: number;
}

/**
 * 轻量 LRU + TTL 缓存，用于查询结果去重。
 *
 * - 超过 maxSize 时删除最旧条目。
 * - 超过 ttlMs 的条目在 get 时自动失效。
 */
export class QueryCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = 50, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /** 获取缓存结果，过期则返回 null 并删除 */
  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  /** 写入缓存，超出 maxSize 时淘汰最旧条目 */
  set(key: string, value: string): void {
    // 如果 key 已存在，先删除以更新插入顺序
    this.cache.delete(key);
    this.cache.set(key, { result: value, createdAt: Date.now() });

    // LRU 淘汰：Map 的迭代顺序 = 插入顺序，最早的在前
    while (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  /** 清空全部缓存 */
  clear(): void {
    this.cache.clear();
  }

  /** 当前缓存条目数（测试用） */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 构建缓存 key："规范化文本|文件:符号"
   *
   * 相同文本 + 相同上下文视为同一查询。
   */
  static buildKey(text: string, context: Context): string {
    const normalized = text.trim().toLowerCase();
    const file = context.active_file ?? '';
    const symbol = context.cursor_symbol ?? '';
    return `${normalized}|${file}:${symbol}`;
  }
}
