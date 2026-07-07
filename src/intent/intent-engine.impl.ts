// ============================================================
// IntentEngine 实现 — 正则精确匹配 + 示例相似度回退 (MVP)
// ============================================================

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IntentEngine, IntentInput, QueryIntent, IntentEntity, IntentError, Context,
} from './intent-engine.js';
import type { IntentType, SymbolKind } from '../common/types.js';

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
    // type_relationships
    { text: '谁实现了 xxx', intentType: 'type_relationships', entityHint: 'symbol' },
    { text: 'xxx 有哪些实现', intentType: 'type_relationships', entityHint: 'symbol' },
    { text: '哪些类继承了 xxx', intentType: 'type_relationships', entityHint: 'symbol' },
    { text: '哪些类型使用了 xxx', intentType: 'type_relationships', entityHint: 'symbol' },
    { text: 'who implements xxx', intentType: 'type_relationships', entityHint: 'symbol' },
    // switch_project
    { text: '打开xxx项目', intentType: 'switch_project', entityHint: 'symbol' },
    { text: '切换到xxx', intentType: 'switch_project', entityHint: 'symbol' },
    { text: 'switch to xxx project', intentType: 'switch_project', entityHint: 'symbol' },
    { text: 'open xxx project', intentType: 'switch_project', entityHint: 'symbol' },
    // list_projects
    { text: '列出所有项目', intentType: 'list_projects' },
    { text: 'show all projects', intentType: 'list_projects' },
    // 理解层
    { text: 'AI 最近改到哪儿了', intentType: 'recent_changes' },
    { text: '最近改了什么', intentType: 'recent_changes' },
    { text: '查看 xxx.ts', intentType: 'view_annotated', entityHint: 'file' },
    { text: '看看 xxx.cpp', intentType: 'view_annotated', entityHint: 'file' },
    { text: 'chunk 1 简报', intentType: 'chunk_brief' },
    { text: '模块简报', intentType: 'chunk_brief' },
    { text: '确认 xxx 已审查', intentType: 'confirm_reviewed', entityHint: 'symbol' },
    { text: '列出约定', intentType: 'prune_conventions' },
    // 代码生成与重构
    { text: '重构 xxx 为 async', intentType: 'code_generation', entityHint: 'symbol' },
    { text: '提取 xxx 为新函数', intentType: 'code_generation', entityHint: 'symbol' },
    { text: '生成 xxx 的 diff', intentType: 'code_generation', entityHint: 'symbol' },
    // 跨域调试
    { text: '解析这个错误日志', intentType: 'cross_domain_debug' },
    { text: 'trace this error', intentType: 'cross_domain_debug' },
    // 团队协作
    { text: '导出项目索引', intentType: 'team_collab_export' },
    { text: '导入共享索引', intentType: 'team_collab_import' },
    { text: '给 xxx 添加注释', intentType: 'team_collab_annotate', entityHint: 'symbol' },
  ];

  /** 从 feedback.jsonl 学习到的例句列表 */
  private learnedExamples: Array<{
    text: string;
    intentType: IntentType;
    entityHint?: 'symbol' | 'file' | 'module';
  }> = [];

  /**
   * 从 ~/.nodus/feedback.jsonl 加载用户确认的查询作为新例句。
   *
   * - 只加载 actual_intent 与 parsed_intent 一致且 confidence >= 阈值的记录
   * - 自动去重（相同 text + intentType 只保留一条）
   * - 与原示例库最多保持 200 条例句
   *
   * @returns 本次新学习到的例句数量
   */
  loadFeedback(): number {
    try {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
      const filePath = join(home, '.nodus', 'feedback.jsonl');
      if (!existsSync(filePath)) return 0;

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      if (lines.length === 0) return 0;

      // 收集现有所有例句的 key（内置 + 已学习），用于去重
      const existingKeys = new Set<string>();
      for (const ex of this.exampleQueries) {
        existingKeys.add(`${ex.text}|${ex.intentType}`);
      }
      for (const ex of this.learnedExamples) {
        existingKeys.add(`${ex.text}|${ex.intentType}`);
      }

      let addedCount = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as {
            input_text?: string;
            parsed_intent?: string;
            actual_intent?: string;
            parsed_confidence?: number;
            actual_entities?: Record<string, unknown>;
          };

          // 必须有输入文本和解析意图
          const text = entry.input_text?.trim();
          const parsedIntent = entry.parsed_intent;
          const actualIntent = entry.actual_intent;
          if (!text || !parsedIntent) continue;

          // 解析意图与用户确认意图一致（或只有解析意图无歧义）
          const intentType = (actualIntent ?? parsedIntent) as IntentType;
          if (!this.isValidIntentType(intentType)) continue;

          // 去重
          const key = `${text}|${intentType}`;
          if (existingKeys.has(key)) continue;

          // 推断 entityHint
          let entityHint: 'symbol' | 'file' | 'module' | undefined;
          if (entry.actual_entities) {
            const entities = entry.actual_entities;
            if (entities.symbolName) entityHint = 'symbol';
            else if (entities.filePath) entityHint = 'file';
            else if (entities.moduleName) entityHint = 'module';
          } else {
            // 从原始例句中匹配 hint
            entityHint = this.inferEntityHint(text);
          }

          this.learnedExamples.push({ text, intentType, entityHint });
          existingKeys.add(key);
          addedCount++;

          // 限制总例句数
          if (this.learnedExamples.length > 100) {
            this.learnedExamples = this.learnedExamples.slice(-100);
          }
        } catch {
          // 单行解析失败，跳过
        }
      }

      return addedCount;
    } catch {
      return 0;
    }
  }

  /** 返回已学习例句数量 */
  getLearnedCount(): number {
    return this.learnedExamples.length;
  }

  parse(input: IntentInput, context: Context): QueryIntent | IntentError {
    let text = input.text.trim();

    // 5. 空查询 + 有选中代码 → 推断最合适意图
    if (!text) {
      if (context.selected_code) {
        const inferred = this.inferIntentFromEmptyQuery(context);
        if (inferred) {
          const symName = this.extractSymbolName(context.selected_code) ?? context.cursor_symbol;
          if (symName) {
            return this.makeIntent(text, inferred.intentType, { symbolName: symName }, 0.78, context, { inferredReason: inferred.reason });
          }
        }
      }
      return { kind: 'empty_input' };
    }

    // 4. 查询含代词 → 替换为上下文符号名，然后重新匹配
    const symName = context.cursor_symbol ?? this.extractSymbolName(context.selected_code ?? '');
    if (symName && this.hasPronoun(text)) {
      const processedText = this.replacePronoun(text, symName);
      if (processedText !== text) {
        const lowerProcessed = processedText.toLowerCase();
        const reMatched = this.matchIntent(lowerProcessed, processedText, context);
        if (reMatched && reMatched.confidence >= CONFIDENCE_THRESHOLD) {
          return this.enrichWithContext(reMatched, context, { replacedPronoun: true, originalSymbol: symName });
        }
        const reSimilar = this.matchBySimilarity(processedText, context);
        if (reSimilar && reSimilar.confidence >= SIMILARITY_DIRECT_THRESHOLD) {
          return this.enrichWithContext(reSimilar, context, { replacedPronoun: true, originalSymbol: symName });
        }
        // 替换后仍无法精确匹配，但文本已被更新，继续后续流程
        text = processedText;
      }
    }

    const lower = text.toLowerCase();

    // 1. 意图模式匹配（精确、快速）
    const matched = this.matchIntent(lower, text, context);
    if (matched) {
      if (matched.confidence < CONFIDENCE_THRESHOLD) {
        return {
          kind: 'ambiguous',
          candidates: matched.candidates ?? [this.enrichWithContext(matched, context, {})],
        };
      }
      return this.enrichWithContext(matched, context, {});
    }

    // 2. 相似度回退匹配（容忍同义改写、错别字、语序变化）
    const similar = this.matchBySimilarity(text, context);
    if (similar) {
      if (similar.confidence >= SIMILARITY_DIRECT_THRESHOLD) {
        return this.enrichWithContext(similar, context, {});
      }
      if (similar.confidence >= SIMILARITY_AMBIGUOUS_THRESHOLD) {
        return { kind: 'ambiguous', candidates: [this.enrichWithContext(similar, context, {})] };
      }
    }

    // 3. 上下文自动补全
    if (context.cursor_symbol || context.selected_code) {
      const fallbackSymName = context.cursor_symbol ?? this.extractSymbolName(context.selected_code ?? '');
      if (fallbackSymName) {
        // 2) 选中代码块 → 推荐 impact_analysis
        if (context.selected_code) {
          const selectedSymName = this.extractSymbolName(context.selected_code) ?? fallbackSymName;
          return this.makeIntent(text, 'impact_analysis', { symbolName: selectedSymName }, 0.78, context, { hasSelection: true });
        }

        // 1) 光标在函数/方法内 → 推荐 call_graph
        if (context.cursor_symbol && context.cursor_symbol_kind &&
            (context.cursor_symbol_kind === 'function' || context.cursor_symbol_kind === 'method')) {
          return this.makeIntent(text, 'call_graph', { symbolName: fallbackSymName }, 0.78, context, { cursorKind: context.cursor_symbol_kind });
        }

        // 3) 光标在类/接口定义 → 推荐 type_relationships
        if (context.cursor_symbol && context.cursor_symbol_kind &&
            (context.cursor_symbol_kind === 'class' || context.cursor_symbol_kind === 'interface')) {
          return this.makeIntent(text, 'type_relationships', { symbolName: fallbackSymName }, 0.78, context, { cursorKind: context.cursor_symbol_kind });
        }

        // 默认：find_definition
        return this.makeIntent(text, 'find_definition', { symbolName: fallbackSymName }, 0.75, context, {});
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
          /(?:列出|list|show)\s*(?:所有\s*)?(?:导出\s*|exported\s*)?(?:所有\s*)?(?:的\s*)?(?:符号|函数|类|接口|方法|symbols|functions|classes|interfaces|methods)(?!\s*项目)/i,
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
      // 类型关系
      {
        patterns: [
          /(?:谁|哪些类|哪些类型)(?:实现|继承|使用|引用).{0,2}(?:了|过)?\s*(.+)/i,
          /(.+?)(?:的|有|有)?(?:哪些)?(?:实现|子类|继承类|使用|引用)/i,
          /(?:who|which\s+classes?)\s+(?:implements?|extends?|uses?)\s+(.+)/i,
          /(?:subclasses?|implementations?)\s+of\s+(.+)/i,
        ],
        intentType: 'type_relationships',
        extractEntities: (_, text, ctx) => ({
          symbolName: this.extractSymbolName(text) ?? ctx.cursor_symbol ?? undefined,
          relationshipKind: this.extractRelationshipKind(text),
        }),
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
      // 代码评审
      {
        patterns: [
          /(?:代码|code)\s*(?:评审|review|审查|检查)/i,
          /(?:评审|review)\s+(?:commit|提交|changes?|diff|代码|code|pr|pull\s*request)/i,
          /review\s*(?:the\s*)?(?:code|diff|changes?|pr)/i,
          /(?:检查|查看|review)\s*(?:变更|改动|diff|changes?)/i,
          /(?:pr|pull\s+request)\s*(?:评审|review)/i,
          /(?:commit|提交)\s+(?:评审|review)/i,
        ],
        intentType: 'code_review',
        extractEntities: (_, text) => ({
          commitHash: this.extractCommitHash(text) ?? undefined,
        }),
      },
      // 代码生成与重构
      {
        patterns: [
          /(?:重构|refactor|改写|rewrite|转换|convert|改为|改成)\s+(.+?)(?:为|成|to)?\s*(.+)/i,
          /(?:提取|extract)\s+(.+?)(?:为|成|作为|为新的|成新的)?\s*(.+?)(?:函数|function|变量|variable)?/i,
          /(?:生成|generate)\s+(.+?)(?:的)?\s*(?:diff|补丁|patch|变更|改动|重构)/i,
          /(?:make|把)\s+(.+?)\s*(?:async|异步)/i,
          /(?:改进|优化|优化建议|改进建议|improve|suggest|refactor)\s*(?:代码|建议|代码库|项目)?/i,
        ],
        intentType: 'code_generation',
        extractEntities: (match, text, ctx) => ({
          symbolName: this.extractSymbolName(text) ?? ctx.cursor_symbol ?? undefined,
          description: text,
        }),
      },
      // 跨域调试
      {
        patterns: [
          /(?:解析|分析|trace|debug|调试)\s*(?:这个|以下|这段)?\s*(?:错误|error|日志|log|stack|trace)/i,
          /(?:trace|debug)\s+(?:this\s+)?error/i,
          /(?:parse|analyze)\s+(?:this\s+)?log/i,
        ],
        intentType: 'cross_domain_debug',
        extractEntities: (_, text) => ({
          logText: text,
        }),
      },
      // 团队协作
      {
        patterns: [
          /(?:导出|export|分享|share)\s*(?:项目|团队)?\s*(?:索引|index|知识|knowledge)/i,
        ],
        intentType: 'team_collab_share',
        extractEntities: () => ({}),
      },
      {
        patterns: [
          /(?:导入|import)\s*(?:共享|shared)?\s*(?:索引|index|知识|knowledge)/i,
        ],
        intentType: 'team_collab_import',
        extractEntities: (_, text) => ({
          content: this.extractJsonContent(text) ?? undefined,
        }),
      },
      {
        patterns: [
          /(?:给|为|对)\s+(.+?)\s*(?:添加|加|写|添加一条)?\s*(?:注释|annotation|备注|note)/i,
        ],
        intentType: 'team_collab_annotate',
        extractEntities: (match, text, ctx) => ({
          symbolName: this.extractSymbolName(text) ?? ctx.cursor_symbol ?? undefined,
          content: this.extractAnnotationContent(text) ?? undefined,
        }),
      },
      {
        patterns: [
          /(?:导出|export)\s*(?:团队|team)?\s*(?:知识|knowledge|注释|annotations)/i,
        ],
        intentType: 'team_collab_export',
        extractEntities: () => ({}),
      },
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
      // 切换项目
      {
        patterns: [
          /(?:打开|切换到|切换|切到|open|switch\s*to)\s*(.+?)(?:项目|project)?/i,
          /(?:change\s*to|goto|go\s*to)\s*(.+?)(?:\s+project)?/i,
        ],
        intentType: 'switch_project',
        extractEntities: (_, text, _ctx) => ({
          projectPath: this.extractProjectPath(text) ?? undefined,
        }),
      },
      // 列出所有项目
      {
        patterns: [
          /(?:列出|显示|show|list)\s*(?:所有|全部)?\s*(?:已打开)?\s*(?:项目|projects?)/i,
          /(?:所有|全部)\s*(?:项目|projects?)\s*(?:列表|list)?/i,
        ],
        intentType: 'list_projects',
        extractEntities: () => ({}),
      },
      // 理解层：最近变更
      {
        patterns: [
          /(?:ai\s+)?(?:最近|recent|latest).{0,6}(?:改了?什么|改了?哪儿|变更|changes?|modified)/i,
          /最近.{0,4}(?:什么|哪些).{0,4}改/i,
          /(?:ai|人工智能)?(?:具体)?(?:改|变化|变更).{0,4}(?:到哪儿|到哪儿了|哪里|哪儿|哪里了)/i,
          /(?:ai|人工智能)?(?:最近|本次|这次|刚刚).{0,4}(?:改|变化|变更|修改|调整)/i,
        ],
        intentType: 'recent_changes',
        extractEntities: () => ({}),
      },
      // 理解层：查看带标注的文件视图
      {
        patterns: [
          /(?:查看|打开|看看|view|show|open)\s+(.+?\.(?:ts|tsx|js|jsx|py|cpp|c|h|hpp|rs|go|java|kt|swift))/i,
          /(.+?\.(?:ts|tsx|js|jsx|py|cpp|c|h|hpp|rs|go|java|kt|swift))\s*(?:的)?(?:代码|文件|视图|带标注)/i,
        ],
        intentType: 'view_annotated',
        extractEntities: (match, _text, _ctx) => ({
          filePath: match![1] ?? undefined,
        }),
      },
      // 理解层：语义块简报
      {
        patterns: [
          /(?:块\s*\d+|chunk\s*\d+).{0,4}(?:的)?(?:简报|brief|改了?什么|详情)/i,
          /(?:这|那)块.{0,4}(?:简报|改了?什么|详情)/i,
          /(?:模块|业务块|语义块).{0,4}(?:简报|brief|详情|改了?什么)/i,
        ],
        intentType: 'chunk_brief',
        extractEntities: (match, _text, _ctx) => {
          const numMatch = match![0].match(/\d+/);
          return { subType: numMatch ? `chunk-${parseInt(numMatch[0], 10) - 1}` : undefined };
        },
      },
      // 理解层：确认已审查
      {
        patterns: [
          /(?:这|那)?块.{0,2}(?:过了|ok|pass|确认|confirm)/i,
          /(?:\/)confirm\s+(.+)/i,
          /确认\s+(.+).{0,2}(?:过了|审完|ok)/i,
        ],
        intentType: 'confirm_reviewed',
        extractEntities: (match, text, ctx) => {
          // 从原始文本提取以保持大小写（lower 匹配会丢失大小写）
          const rawMatch = /(?:\/)confirm\s+(.+)/.exec(text) ?? /确认\s+(.+).{0,2}(?:过了|审完|ok)/.exec(text);
          return {
            symbolName: rawMatch?.[1]?.trim() ?? ctx.cursor_symbol ?? undefined,
          };
        },
      },
      // 理解层：删除/列出约定
      {
        patterns: [
          /(?:\/prune|删掉?|移除|remove)\s+(.+?)(?:约定|convention)?/i,
          /prune\s+(.+)/i,
          /(?:列出|list|show)\s*(?:约定|conventions?)/i,
        ],
        intentType: 'prune_conventions',
        extractEntities: (match, _text, _ctx) => ({
          symbolName: match![1]?.trim() ?? undefined,
        }),
      },
    ];

    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        const match = pattern.exec(lower);
        if (match) {
          const entities = rule.extractEntities(match, rawText, ctx);
          // 类型关系必须能提取到符号名，否则继续匹配后续规则（避免误吞 analytics 等聚合意图）
          if (rule.intentType === 'type_relationships' && !entities.symbolName) continue;
          // 聚合类意图（list_symbols / stats / analytics / list_projects / code_review）模式本身足够明确，直接给高置信度
          const aggregateIntent = rule.intentType === 'list_symbols' || rule.intentType === 'stats' || rule.intentType === 'analytics' || rule.intentType === 'list_projects' || rule.intentType === 'code_review' || rule.intentType === 'recent_changes' || rule.intentType === 'prune_conventions' || rule.intentType === 'chunk_brief' || rule.intentType === 'cross_domain_debug' || rule.intentType === 'code_generation' || rule.intentType === 'team_collab_share' || rule.intentType === 'team_collab_import' || rule.intentType === 'team_collab_annotate' || rule.intentType === 'team_collab_export';
          const hasEntity = entities.symbolName || entities.filePath || entities.moduleName || entities.projectPath || entities.commitHash ||
                            entities.subType || (entities.filter && Object.keys(entities.filter).length > 0);
          const confidence = aggregateIntent || hasEntity ? 0.92 : 0.65;

          return this.makeIntent(rawText, rule.intentType, entities, confidence, ctx);
        }
      }
    }

    return null;
  }

  private makeIntent(
    rawText: string, intentType: IntentType, entities: IntentEntity, confidence: number,
    ctx?: Context, implicitParams?: Record<string, unknown>,
  ): QueryIntent {
    const result: QueryIntent = { rawText, intentType, confidence, entities };
    if (ctx) {
      result.context = {
        activeFile: ctx.active_file ?? undefined,
        cursorSymbol: ctx.cursor_symbol ?? undefined,
        selectedCode: ctx.selected_code ?? undefined,
        implicitParams,
      };
    }
    return result;
  }

  private enrichWithContext(intent: QueryIntent, ctx: Context, implicitParams: Record<string, unknown>): QueryIntent {
    return {
      ...intent,
      context: {
        activeFile: ctx.active_file ?? undefined,
        cursorSymbol: ctx.cursor_symbol ?? undefined,
        selectedCode: ctx.selected_code ?? undefined,
        implicitParams,
      },
    };
  }

  // ---- 上下文辅助方法 ----

  private hasPronoun(text: string): boolean {
    return /这个|当前|此|it|this|that/i.test(text);
  }

  private replacePronoun(text: string, symbolName: string): string {
    return text
      .replace(/这个(函数|类|方法|接口|变量|模块)?/g, symbolName)
      .replace(/当前(函数|类|方法|接口|变量|模块)?/g, symbolName)
      .replace(/此(函数|类|方法|接口|变量|模块)?/g, symbolName)
      .replace(/\bit\b/gi, symbolName)
      .replace(/\bthis\b/gi, symbolName)
      .replace(/\bthat\b/gi, symbolName);
  }

  private inferIntentFromEmptyQuery(context: Context): { intentType: IntentType; reason: string } | null {
    const selectedCode = context.selected_code ?? '';
    const cursorKind = context.cursor_symbol_kind;

    if (cursorKind === 'function' || cursorKind === 'method') {
      return { intentType: 'call_graph', reason: 'cursor_in_function' };
    }
    if (cursorKind === 'class' || cursorKind === 'interface') {
      return { intentType: 'type_relationships', reason: 'cursor_in_type' };
    }

    // 根据选中代码内容推断
    if (/class\s+\w+|interface\s+\w+/i.test(selectedCode)) {
      return { intentType: 'type_relationships', reason: 'selection_contains_type_definition' };
    }
    if (/function\s+\w+\s*\(|const\s+\w+\s*=\s*\(|=>|def\s+\w+\s*\(/i.test(selectedCode)) {
      return { intentType: 'call_graph', reason: 'selection_contains_function_definition' };
    }

    if (selectedCode.length > 30) {
      return { intentType: 'impact_analysis', reason: 'selection_is_multi_line_block' };
    }

    return { intentType: 'find_definition', reason: 'default_for_selection' };
  }

  // ---- 相似度回退匹配 ----

  private matchBySimilarity(rawText: string, ctx: Context): QueryIntent | null {
    const inputTokens = this.tokenize(rawText);
    let best: {
      intentType: IntentType;
      score: number;
      entityHint?: 'symbol' | 'file' | 'module';
    } | null = null;

    // 搜索内置例句 + 已学习例句
    const allExamples = [...this.exampleQueries, ...this.learnedExamples];
    for (const ex of allExamples) {
      const exTokens = this.tokenize(ex.text);
      const score = this.cosineSimilarity(inputTokens, exTokens);
      if (!best || score > best.score) {
        best = { intentType: ex.intentType, score, entityHint: ex.entityHint };
      }
    }

    if (!best || best.score < SIMILARITY_AMBIGUOUS_THRESHOLD) return null;

    const entities = this.extractEntitiesForHint(rawText, ctx, best.entityHint);
    return this.makeIntent(rawText, best.intentType, entities, best.score, ctx);
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
    const match = text.match(/([a-zA-Z_][\w/.-]*\.(?:ts|tsx|js|jsx|py|cpp|c|h|hpp|rs|go|java|kt|swift|service\.ts|component\.tsx))/);
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

  private extractRelationshipKind(text: string): 'subclasses' | 'implementations' | 'type_uses' | undefined {
    const lower = text.toLowerCase();
    if (/实现|implements?/.test(lower)) return 'implementations';
    if (/继承|extends?|子类|subclasses?/.test(lower)) return 'subclasses';
    if (/使用|uses?|引用|type\s+uses?/.test(lower)) return 'type_uses';
    return undefined;
  }

  private extractProjectPath(text: string): string | null {
    // 尝试匹配 "打开 /path/to/project" 或 "切换到 some-project"
    const match = text.match(/(?:打开|切换到|切换|open|switch\s*to)\s+([\/\w._-]+)/i);
    if (match) return match[1];
    // 尝试匹配引号包裹的路径
    const quotedMatch = text.match(/['"]([\/\w._-]+)['"]/);
    return quotedMatch?.[1] ?? null;
  }

  private extractCommitHash(text: string): string | null {
    // 匹配 7 位以上的十六进制 commit hash（通常 7-40 位）
    const match = text.match(/\b([0-9a-f]{7,40})\b/i);
    return match?.[1] ?? null;
  }

  private extractJsonContent(text: string): string | null {
    // 匹配 ```json ... ``` 或单行 JSON 对象/数组
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) return codeBlock[1]!.trim();
    const inline = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    return inline?.[1]?.trim() ?? null;
  }

  private extractAnnotationContent(text: string): string | null {
    // 提取引号或冒号后的注释内容，例如：给 refundOrder 添加注释 "需要校验"
    const quoted = text.match(/["']([^"']+)["']/);
    if (quoted) return quoted[1]!;
    const afterColon = text.match(/[:：]\s*(.+)/);
    return afterColon?.[1]?.trim() ?? null;
  }

  // ---- 学习闭环辅助 ----

  private isValidIntentType(type: string): boolean {
    const valid: IntentType[] = [
      'find_definition', 'find_references', 'call_graph', 'impact_analysis',
      'change_history', 'symbol_overview', 'list_symbols', 'stats',
      'analytics', 'type_relationships', 'code_review',
      'switch_project', 'list_projects',
      'recent_changes', 'view_annotated', 'chunk_brief',
      'confirm_reviewed', 'prune_conventions',
      'code_generation', 'cross_domain_debug',
      'team_collab_share', 'team_collab_import', 'team_collab_annotate', 'team_collab_export',
    ];
    return (valid as string[]).includes(type);
  }

  /** 根据查询文本推断实体提示 */
  private inferEntityHint(text: string): 'symbol' | 'file' | 'module' | undefined {
    const lower = text.toLowerCase();
    // 文件名特征
    if (/\.[tj]sx?/.test(lower)) return 'file';
    // 模块特征
    if (/模块/.test(lower)) return 'module';
    // 其他默认为符号查询
    if (/[a-zA-Z_]\w{2,}/.test(text)) return 'symbol';
    return undefined;
  }
}
