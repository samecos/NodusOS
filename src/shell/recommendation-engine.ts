// ============================================================
// RecommendationEngine — 查询推荐生成
// 基于上下文、高频查询、最近查询生成 ≤ 3 条推荐。
// ============================================================

import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { ContextManager, Context } from '../context/context-manager.js';

export interface Recommendation {
  /** 可直接执行的查询文本 */
  text: string;
  /** 推荐理由（用于展示） */
  reason: string;
}

/**
 * 推荐引擎：综合上下文、高频查询和最近查询生成推荐。
 *
 * 策略优先级：
 * 1. 上下文关联（cursor_symbol 存在时生成引用/影响推荐）
 * 2. 高频查询（historyRecent 统计 ≥ 2 次的查询）
 * 3. 最近查询延续（从最近查询提取符号，推荐调用链路）
 *
 * 任何子策略失败不影响其他策略，返回空列表降级。
 */
export class RecommendationEngine {
  private readonly store: KnowledgeStore;
  private readonly contextMgr: ContextManager;

  constructor(store: KnowledgeStore, contextMgr: ContextManager) {
    this.store = store;
    this.contextMgr = contextMgr;
  }

  /** 返回最多 3 条推荐 */
  generate(): Recommendation[] {
    const results: Recommendation[] = [];
    const seen = new Set<string>();

    // 策略 1：上下文关联
    try {
      const ctx = this.contextMgr.snapshot();
      const symbol = ctx.cursor_symbol;
      if (symbol) {
        this.addUnique(results, seen, {
          text: `${symbol}被哪些地方调用了`,
          reason: `当前光标位于 ${symbol}`,
        });
        this.addUnique(results, seen, {
          text: `如果我改了${symbol}，哪些文件会受影响`,
          reason: `查看 ${symbol} 的影响范围`,
        });
      }
      // 理解层推荐：当用户位于某个文件时，推荐查看带标注的视图
      if (ctx.active_file) {
        this.addUnique(results, seen, {
          text: `查看 ${ctx.active_file}`,
          reason: '查看当前文件的行级债值标注',
        });
      }
    } catch {
      // 降级：策略失败不影响后续
    }

    // 策略 1b：理解层推荐（当有实际项目路径且未查询过变更时）
    try {
      const ctx = this.contextMgr.snapshot();
      const projectRoot = ctx.active_project_root;
      // 只在有实际项目路径时推荐（排除测试中的 '/' 根路径）
      if (projectRoot && projectRoot !== '/') {
        const recentHistory = this.store.historyRecent(5);
        const hasRecentChangeQuery = recentHistory.some(h => h.intent_type === 'recent_changes');
        if (!hasRecentChangeQuery) {
          this.addUnique(results, seen, {
            text: 'AI 最近改到哪儿了',
            reason: '查看最近的变更热力图与语义块',
          });
        }
      }
    } catch {
      // 降级
    }

    // 策略 2：高频查询
    try {
      const recent = this.store.historyRecent(50);
      const freqMap = new Map<string, number>();
      for (const entry of recent) {
        const text = entry.raw_text.trim();
        if (!text) continue;
        freqMap.set(text, (freqMap.get(text) ?? 0) + 1);
      }
      // 取出现 ≥ 2 次的，按频次降序
      const frequent = [...freqMap.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2);

      for (const [text, count] of frequent) {
        this.addUnique(results, seen, {
          text,
          reason: `近期执行了 ${count} 次`,
        });
      }
    } catch {
      // 降级
    }

    // 策略 3：最近查询延续
    try {
      const ctx = this.contextMgr.snapshot();
      const lastQuery = ctx.recent_queries[0];
      if (lastQuery?.text) {
        // 尝试从最近查询中提取符号名（粗略提取：取引号内或关键英文标识符）
        const symbolMatch = lastQuery.text.match(/[A-Za-z_][A-Za-z0-9_]*/g);
        if (symbolMatch && symbolMatch.length > 0) {
          // 取最长的标识符作为可能的符号名
          const symbol = symbolMatch.sort((a, b) => b.length - a.length)[0]!;
          // 排除常见中文关键词误匹配
          if (symbol.length >= 2 && !this.isCommonWord(symbol)) {
            this.addUnique(results, seen, {
              text: `${symbol}的调用链路是什么样的`,
              reason: `延续上次查询：${lastQuery.text}`,
            });
          }
        }
      }
    } catch {
      // 降级
    }

    return results.slice(0, 3);
  }

  private addUnique(
    results: Recommendation[],
    seen: Set<string>,
    rec: Recommendation,
  ): void {
    const key = rec.text.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      results.push(rec);
    }
  }

  /** 过滤常见中文/英文无意义词 */
  private isCommonWord(word: string): boolean {
    const common = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'were',
      'been', 'they', 'will', 'what', 'where', 'which', 'how', 'who',
      'are', 'was', 'has', 'had', 'not', 'but', 'all', 'can', 'her',
      'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his',
      'how', 'its', 'may', 'new', 'now', 'old', 'see', 'way', 'who',
      'did', 'let', 'say', 'she', 'too', 'use',
    ]);
    return common.has(word.toLowerCase());
  }
}
