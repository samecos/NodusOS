// ============================================================
// IntentEngine 实现 — 正则精确匹配 + 示例相似度回退 (MVP)
// ============================================================

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IntentEngine, IntentInput, QueryIntent, IntentEntity, IntentError, Context,
} from './intent-engine.js';
import type { IntentType } from '../common/types.js';

const CONFIDENCE_THRESHOLD = 0.8;
const SIMILARITY_DIRECT_THRESHOLD = 0.65;
const SIMILARITY_AMBIGUOUS_THRESHOLD = 0.45;

export class PatternIntentEngine implements IntentEngine {
  /** 标准查询例句库：用于相似度回退匹配 */
  private readonly exampleQueries: Array<{
    text: string;
    intentType: IntentType;
    entityHint?: 'symbol' | 'file' | 'module';
  }> = [
    // find_definition
    { text: 'xxx在哪里定义的', intentType: 'find_definition', entityHint: 'symbol' },
    { text: 'xxx的定义', intentType: 'find_definition', entityHint: 'symbol' },
    { text: 'where is xxx defined', intentType: 'find_definition', entityHint: 'symbol' },
    { text: 'find xxx', intentType: 'find_definition', entityHint: 'symbol' },
    { text: 'locate the definition of xxx', intentType: 'find_definition', entityHint: 'symbol' },
    // find_references
    { text: 'xxx被哪些地方调用了', intentType: 'find_references', entityHint: 'symbol' },
    { text: 'xxx的引用', intentType: 'find_references', entityHint: 'symbol' },
    { text: 'who calls xxx', intentType: 'find_references', entityHint: 'symbol' },
    { text: 'references to xxx', intentType: 'find_references', entityHint: 'symbol' },
    // call_graph
    { text: 'xxx的调用链路', intentType: 'call_graph', entityHint: 'symbol' },
    { text: 'xxx的调用链', intentType: 'call_graph', entityHint: 'symbol' },
    { text: 'call graph of xxx', intentType: 'call_graph', entityHint: 'symbol' },
    // impact_analysis
    { text: '如果我改了xxx哪些文件会受影响', intentType: 'impact_analysis', entityHint: 'symbol' },
    { text: '改动xxx会影响哪些地方', intentType: 'impact_analysis', entityHint: 'symbol' },
    { text: 'xxx的影响范围', intentType: 'impact_analysis', entityHint: 'symbol' },
    { text: 'what would break if i change xxx', intentType: 'impact_analysis', entityHint: 'symbol' },
    { text: 'impact analysis of xxx', intentType: 'impact_analysis', entityHint: 'symbol' },
    { text: 'which files are affected by changing xxx', intentType: 'impact_analysis', entityHint: 'symbol' },
    // change_history
    { text: 'xxx模块最近一周改了什么', intentType: 'change_history', entityHint: 'module' },
    { text: 'xxx最近有什么变更', intentType: 'change_history', entityHint: 'module' },
    { text: 'change history of xxx', intentType: 'change_history', entityHint: 'module' },
    // symbol_overview
    { text: 'xxx里有哪些函数', intentType: 'symbol_overview', entityHint: 'file' },
    { text: 'xxx里有哪些符号', intentType: 'symbol_overview', entityHint: 'file' },
    { text: 'list symbols in xxx', intentType: 'symbol_overview', entityHint: 'file' },
    // list_symbols
    { text: '列出所有函数', intentType: 'list_symbols' },
    { text: '列出所有导出符号', intentType: 'list_symbols' },
    { text: 'list all functions', intentType: 'list_symbols' },
    { text: 'show all exports in xxx', intentType: 'list_symbols', entityHint: 'file' },
    // stats
    { text: '代码统计', intentType: 'stats' },
    { text: '项目统计', intentType: 'stats' },
    { text: 'statistics', intentType: 'stats' },
    { text: 'how many functions are there', intentType: 'stats' },
    // analytics
    { text: '调用次数最多的函数', intentType: 'analytics' },
    { text: '影响范围最大的函数', intentType: 'analytics' },
    { text: '哪些导出没被使用', intentType: 'analytics' },
    { text: '模块耦合度', intentType: 'analytics' },
    { text: '最长调用链', intentType: 'analytics' },
    { text: '入口函数', intentType: 'analytics' },
    { text: 'TODO 列表', intentType: 'analytics' },
    { text: '复杂度最高的函数', intentType: 'analytics' },
    { text: '变更热点文件', intentType: 'analytics' },
  ];

  parse(input: IntentInput, context: Context): QueryIntent | IntentError {
    const text = input.text.trim();
    if (!text) return { kind: 'empty_input' };

    const lower = text.toLowerCase();

    // 1. 意图模式匹配（精确、快速）
    const matched = this.matchIntent(lower, text, context);
    if (matched) {
      if (matched.confidence < CONFIDENCE_THRESHOLD) {
        return {
          kind: 'ambiguous',
          candidates: matched.candidates ?? [matched],
        };
      }
      return matched;
    }

    // 2. 相似度回退匹配（容忍同义改写、错别字、语序变化）
    const similar = this.matchBySimilarity(text, context);
    if (similar) {
      if (similar.confidence >= SIMILARITY_DIRECT_THRESHOLD) {
        return similar;
      }
      if (similar.confidence >= SIMILARITY_AMBIGUOUS_THRESHOLD) {
        return { kind: 'ambiguous', candidates: [similar] };
      }
    }

    // 3. 上下文自动补全
    if (context.cursor_symbol || context.selected_code) {
      const symName = context.cursor_symbol ?? this.extractSymbolName(context.selected_code ?? '');
      if (symName) {
        return this.makeIntent(text, 'find_definition', { symbolName: symName }, 0.75);
      }
    }

    return { kind: 'unparseable', rawText: text };
  }

  resolveAmbiguity(candidates: QueryIntent[], chosenIndex: number): QueryIntent {
    return candidates[chosenIndex]!;
  }

  recordFeedback(input: IntentInput, parsed: QueryIntent | null, actual: QueryIntent): void {
    // 记录反馈用于持续优化意图分类
    const entry = {
      timestamp: new Date().toISOString(),
      input_text: input.text,
      input_source: input.source,
      parsed_intent: parsed?.intentType ?? null,
      parsed_confidence: parsed?.confidence ?? null,
      actual_intent: actual.intentType,
      actual_entities: actual.entities,
    };

    // 写入 ~/.nodus/feedback.jsonl（追加一行 JSON）
    try {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
      const dir = join(home, '.nodus');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'feedback.jsonl'), JSON.stringify(entry) + '\n');
    } catch {
      // 静默失败 — 反馈记录不影响主流程
    }
  }

  // ---- 匹配逻辑 ----

  private matchIntent(lower: string, rawText: string, ctx: Context): QueryIntent | null {
    const rules: Array<{
      patterns: RegExp[];
      intentType: IntentType;
      extractEntities: (match: RegExpMatchArray | null, text: string, ctx: Context) => IntentEntity;
    }> = [
      // 定义定位
      {
        patterns: [
          /(.+?)(?:在哪里定义的|的定义|在哪里|在哪|defined|where is|definition of)/i,
          /(?:find|show|look\s*up)\s+(.+)/i,
        ],
        intentType: 'find_definition',
        extractEntities: (_, text, ctx) => ({
          symbolName: this.extractSymbolName(text) ?? ctx.cursor_symbol ?? undefined,
        }),
      },
      // 引用查找
      {
        patterns: [
          /(.+?)(?:被哪些地方调用了|被谁引用|的引用|的调用方|who calls|references to|referenced by|called by)/i,
          /(?:find|show)\s+(?:all\s+)?references?\s+(?:of|to)\s+(.+)/i,
        ],
        intentType: 'find_references',
        extractEntities: (_, text, ctx) => ({
          symbolName: this.extractSymbolName(text) ?? ctx.cursor_symbol ?? undefined,
        }),
      },
      // 调用链路
      {
        patterns: [
          /(.+?)(?:的调用链路|的调用链|的调用图|call graph|call chain|调用路径|从.+到.+的链路)/i,
          /(?:show|display)\s+(?:the\s+)?call\s*(?:graph|chain)\s+(?:of|for)\s+(.+)/i,
          /(?:从)(.+?)(?:到)(.+?)(?:的完整链路|的调用)/i,
        ],
        intentType: 'call_graph',
        extractEntities: (_, text, ctx) => ({
          symbolName: this.extractSymbolName(text) ?? ctx.cursor_symbol ?? undefined,
        }),
      },
      // 影响分析
      {
        patterns: [
          /(?:如果)?(?:我)?(?:改(?:了|变)|修改)(.+?)(?:会)?(?:影响哪些|哪些.{0,4}会.{0,2}(?:受|收).{0,2}影响|影响范围|what\s+would\s+break)/i,
          /(.+?)(?:的影响范围|impact analysis|affected files|改了?会.?影响)/i,
        ],
        intentType: 'impact_analysis',
        extractEntities: (_, text, ctx) => ({
          symbolName: this.extractSymbolName(text) ?? ctx.cursor_symbol ?? undefined,
        }),
      },
      // 变更历史
      {
        patterns: [
          /(.+?)(?:最近|这周|这个月|上周|上个月)(?:改了?什么|有什么变更|change history|变更历史|changes)/i,
          /(?:谁|who)(?:动了|改(?:了|过)|changed|modified)\s*(.+)/i,
          /(.+?)模块(.+?)改了什么/i,
        ],
        intentType: 'change_history',
        extractEntities: (_, text, _ctx) => {
          const timeRange = this.extractTimeRange(text);
          const moduleName = this.extractModuleName(text);
          return { moduleName: moduleName ?? undefined, timeRange };
        },
      },
      // 列表查询（先于 symbol_overview，避免“列出所有导出函数”被误判为概览）
      {
        patterns: [
          /(?:列出|list|show)\s*(?:所有\s*)?(?:导出\s*|exported\s*)?(?:所有\s*)?(?:的\s*)?(?:符号|函数|类|接口|方法|symbols|functions|classes|interfaces|methods)?/i,
          /(?:哪些|what)\s+(?:符号|函数|类|接口|symbols|functions|classes|interfaces)\s*(?:在|in)\s*(.+)/i,
        ],
        intentType: 'list_symbols',
        extractEntities: (_, text, ctx) => ({
          filter: this.extractSymbolFilter(text, ctx),
        }),
      },
      // 统计
      {
        patterns: [
          /(?:代码|项目|代码库)?.*?\s*(?:统计|statistics|stats|概览|overview)/i,
          /(?:统计|statistics|stats|概览|overview).*?(?:代码|项目|代码库)?/i,
          /(?:有多少|how many)\s+(?:个\s+)?(.+?)(?:符号|函数|类|文件|symbols|functions|classes|files)?/i,
        ],
        intentType: 'stats',
        extractEntities: () => ({}),
      },
      // 分析
      {
        patterns: [
          /(?:调用次数最多|最热|most called|top called)\s*(?:的\s*)?(?:函数|方法|functions|methods)?/i,
          /(?:影响范围最大|most impactful|most impactful symbols?)/i,
          /(?:未使用|没用|死代码|unused|dead)\s*(?:的\s*)?(?:导出|exports?)?/i,
          /(?:模块耦合|耦合度|most coupled|module coupling)/i,
          /(?:最长调用链|longest call chain)/i,
          /(?:入口|entry points?|entry functions?)/i,
          /(?:TODO|FIXME|HACK|待办|备忘)\s*(?:列表|list|注释|comments)?/i,
          /(?:复杂度最高|最复杂|most complex|complexity)/i,
          /(?:变更热点|最热文件|most changed|change heat|changed files)/i,
        ],
        intentType: 'analytics',
        extractEntities: (_, text) => ({
          subType: this.extractAnalyticsSubType(text),
        }),
      },
      // 符号概览
      {
        patterns: [
          /(.+?)(?:里有哪些|有哪些|里面有什么|what'?s in|symbols in|contains|导出)/i,
          /(?:list|show)\s+(?:all\s+)?(?:symbols|functions|exports)\s+(?:in|of)\s+(.+)/i,
        ],
        intentType: 'symbol_overview',
        extractEntities: (_, text, ctx) => ({
          filePath: this.extractFilePath(text) ?? ctx.active_file ?? undefined,
        }),
      },
    ];

    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        const match = pattern.exec(lower);
        if (match) {
          const entities = rule.extractEntities(match, rawText, ctx);
          // 聚合类意图（list_symbols / stats / analytics）模式本身足够明确，直接给高置信度
          const aggregateIntent = rule.intentType === 'list_symbols' || rule.intentType === 'stats' || rule.intentType === 'analytics';
          const hasEntity = entities.symbolName || entities.filePath || entities.moduleName ||
                            entities.subType || (entities.filter && Object.keys(entities.filter).length > 0);
          const confidence = aggregateIntent || hasEntity ? 0.92 : 0.65;

          return this.makeIntent(rawText, rule.intentType, entities, confidence);
        }
      }
    }

    return null;
  }

  private makeIntent(
    rawText: string, intentType: IntentType, entities: IntentEntity, confidence: number,
  ): QueryIntent {
    return { rawText, intentType, confidence, entities };
  }

  // ---- 相似度回退匹配 ----

  private matchBySimilarity(rawText: string, ctx: Context): QueryIntent | null {
    const inputTokens = this.tokenize(rawText);
    let best: {
      intentType: IntentType;
      score: number;
      entityHint?: 'symbol' | 'file' | 'module';
    } | null = null;

    for (const ex of this.exampleQueries) {
      const exTokens = this.tokenize(ex.text);
      const score = this.cosineSimilarity(inputTokens, exTokens);
      if (!best || score > best.score) {
        best = { intentType: ex.intentType, score, entityHint: ex.entityHint };
      }
    }

    if (!best || best.score < SIMILARITY_AMBIGUOUS_THRESHOLD) return null;

    const entities = this.extractEntitiesForHint(rawText, ctx, best.entityHint);
    return this.makeIntent(rawText, best.intentType, entities, best.score);
  }

  private tokenize(text: string): string[] {
    // 把标识符统一替换成占位符，让相似度聚焦在意图关键词而非具体符号名
    const normalized = text.toLowerCase().replace(/[a-z0-9_]\w+/g, '__sym__');
    const tokens: string[] = [];
    // 字符二元组：对中文/缩写/拼写错误鲁棒
    for (let i = 0; i < normalized.length - 1; i++) {
      tokens.push(normalized.slice(i, i + 2));
    }
    // 英文单词与占位符
    const words = normalized.match(/[a-z0-9_]+/g) ?? [];
    return [...tokens, ...words];
  }

  private cosineSimilarity(a: string[], b: string[]): number {
    const freqA = new Map<string, number>();
    const freqB = new Map<string, number>();
    for (const t of a) freqA.set(t, (freqA.get(t) ?? 0) + 1);
    for (const t of b) freqB.set(t, (freqB.get(t) ?? 0) + 1);

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (const [t, c] of freqA) {
      normA += c * c;
      if (freqB.has(t)) dot += c * (freqB.get(t) ?? 0);
    }
    for (const c of freqB.values()) normB += c * c;

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private extractEntitiesForHint(
    text: string,
    ctx: Context,
    hint?: 'symbol' | 'file' | 'module',
  ): IntentEntity {
    const entities: IntentEntity = {};
    if (hint === 'symbol') {
      entities.symbolName = this.extractSymbolName(text) ?? ctx.cursor_symbol ?? undefined;
    } else if (hint === 'file') {
      entities.filePath = this.extractFilePath(text) ?? ctx.active_file ?? undefined;
    } else if (hint === 'module') {
      entities.moduleName = this.extractModuleName(text) ?? undefined;
      entities.timeRange = this.extractTimeRange(text);
    }
    return entities;
  }

  // ---- 实体提取 ----

  private extractSymbolName(text: string): string | null {
    // 常见停用词，避免把英文虚词误判为符号名
    const commonWords = new Set([
      'the', 'of', 'is', 'where', 'find', 'show', 'look', 'up', 'who', 'calls',
      'references', 'to', 'call', 'graph', 'chain', 'impact', 'analysis', 'affected',
      'files', 'what', 'would', 'break', 'if', 'i', 'change', 'locate', 'definition',
      'module', 'symbols', 'functions', 'exports', 'in', 'for', 'a', 'an', 'and',
      'or', 'how', 'does', 'are', 'there', 'any', 'recent', 'changes', 'history',
    ]);

    const matches = text.match(/\b[a-zA-Z_]\w{1,40}\b/g) ?? [];
    const candidates = matches.filter(w => !commonWords.has(w.toLowerCase()));
    if (candidates.length === 0) return matches[0] ?? null;

    // 优先选较长的、带下划线或驼峰分隔的标识符
    const scored = candidates.map(w => ({
      word: w,
      score: w.length + (w.includes('_') ? 5 : 0) + (/[a-z][A-Z]/.test(w) ? 3 : 0),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.word;
  }

  private extractFilePath(text: string): string | null {
    const match = text.match(/([a-zA-Z_][\w/.-]*\.(ts|tsx|js|jsx|py|service\.ts|component\.tsx))/);
    return match?.[1] ?? null;
  }

  private extractModuleName(text: string): string | null {
    // "auth 模块" or "src/auth" etc.
    const match = text.match(/(?:模块\s*)?([a-zA-Z_]\w+)(?:\s*模块)/);
    if (match) return match[1];
    const dirMatch = text.match(/(?:src\/|app\/|lib\/)([a-zA-Z_]\w+)/);
    return dirMatch?.[1] ?? null;
  }

  private extractTimeRange(text: string): { from: Date; to: Date } | undefined {
    const now = new Date();
    const to = new Date(now);

    if (/最近|这周|过去.?周|last\s+week|this\s+week|recent/i.test(text)) {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return { from, to };
    }
    if (/这个月|本月|this\s+month/i.test(text)) {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to };
    }
    if (/昨天|yesterday/i.test(text)) {
      const from = new Date(now);
      from.setDate(from.getDate() - 1);
      from.setHours(0, 0, 0, 0);
      return { from, to };
    }
    return undefined;
  }

  private extractSymbolFilter(text: string, ctx: Context): NonNullable<IntentEntity['filter']> {
    const filter: NonNullable<IntentEntity['filter']> = {};
    const lower = text.toLowerCase();

    if (/函数|functions?/.test(lower)) filter.kind = 'function';
    else if (/类|classes?/.test(lower)) filter.kind = 'class';
    else if (/接口|interfaces?/.test(lower)) filter.kind = 'interface';
    else if (/方法|methods?/.test(lower)) filter.kind = 'method';

    if (/导出|exported|exports?/.test(lower)) filter.exportedOnly = true;

    const filePath = this.extractFilePath(text) ?? ctx.active_file ?? undefined;
    if (filePath) filter.filePath = filePath;

    const moduleMatch = text.match(/(?:src\/|app\/|lib\/)([a-zA-Z_][\w/]+)/);
    if (moduleMatch) filter.modulePath = moduleMatch[0];

    return filter;
  }

  private extractAnalyticsSubType(text: string): string | undefined {
    const lower = text.toLowerCase();
    if (/调用次数最多|最热|most called|top called/.test(lower)) return 'most_called';
    if (/影响范围最大|most impactful/.test(lower)) return 'most_impactful';
    if (/未使用|没用|死代码|unused|dead/.test(lower)) return 'unused_exports';
    if (/模块耦合|耦合度|most coupled|module coupling/.test(lower)) return 'coupled_modules';
    if (/最长调用链|longest call chain/.test(lower)) return 'longest_chains';
    if (/入口|entry points?|entry functions?/.test(lower)) return 'entry_points';
    if (/todo|fixme|hack|待办|备忘/.test(lower)) return 'todos';
    if (/复杂度最高|最复杂|most complex|complexity/.test(lower)) return 'complexity';
    if (/变更热点|最热文件|most changed|change heat|changed files/.test(lower)) return 'most_changed';
    return undefined;
  }
}
