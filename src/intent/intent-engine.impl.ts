// ============================================================
// IntentEngine 实现 — 关键词+模式匹配 (MVP)
// ============================================================

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IntentEngine, IntentInput, QueryIntent, IntentEntity, IntentError, Context,
} from './intent-engine.js';
import type { IntentType } from '../common/types.js';

const CONFIDENCE_THRESHOLD = 0.8;

export class PatternIntentEngine implements IntentEngine {
  parse(input: IntentInput, context: Context): QueryIntent | IntentError {
    const text = input.text.trim();
    if (!text) return { kind: 'empty_input' };

    const lower = text.toLowerCase();

    // 意图模式匹配
    const matched = this.matchIntent(lower, text, context);
    if (!matched) {
      // 尝试有上下文时补全
      if (context.cursor_symbol || context.selected_code) {
        const symName = context.cursor_symbol ?? this.extractSymbolName(context.selected_code ?? '');
        if (symName) {
          return this.makeIntent(text, 'find_definition', { symbolName: symName }, 0.75);
        }
      }
      return { kind: 'unparseable', rawText: text };
    }

    if (matched.confidence < CONFIDENCE_THRESHOLD) {
      return {
        kind: 'ambiguous',
        candidates: matched.candidates ?? [matched],
      };
    }

    return matched;
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
          /(?:如果)?(?:我)?(?:改(?:了|变)|修改)(.+?)(?:会)?(?:影响哪些|哪些文件会受|what\s+would\s+break)/i,
          /(.+?)(?:的影响范围|impact analysis|affected files)/i,
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
          // 如果没有足够的实体信息，降低置信度
          const hasEntity = entities.symbolName || entities.filePath || entities.moduleName;
          const confidence = hasEntity ? 0.92 : 0.65;

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

  // ---- 实体提取 ----

  private extractSymbolName(text: string): string | null {
    // 匹配驼峰或下划线命名的标识符
    const match = text.match(/\b([a-zA-Z_]\w{1,40})\b/);
    return match?.[1] ?? null;
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
}
