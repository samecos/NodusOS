// ============================================================
// IntentEngine 测试 — TC-UT-IE-001 ~ TC-UT-IE-015
// ============================================================

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { PatternIntentEngine } from './intent-engine.impl.js';
import type { Context, QueryIntent } from './intent-engine.js';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let feedbackTmpDir: string;

function makeCtx(overrides: Partial<Context> = {}): Context {
  return {
    active_file: null, cursor_line: null, cursor_col: null,
    cursor_symbol: null, selected_code: null, selected_range: null,
    recent_queries: [], active_project_root: '/test',
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

  // TC-UT-IE-016: 影响分析（用户实际问法）
  it('should recognize impact_analysis with "收到影响" phrasing', () => {
    const result = parse('如果我修改了refine_edge_points哪些文件会收到影响');
    expect('intentType' in result && result.intentType).toBe('impact_analysis');
    if ('entities' in result) {
      expect(result.entities?.symbolName).toBe('refine_edge_points');
    }
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

  // TC-UT-IE-017: 相似度回退匹配
  it('should recognize paraphrased impact_analysis via similarity', () => {
    const result = parse('改动 refine_edge_points 会影响哪些地方');
    expect('intentType' in result && result.intentType).toBe('impact_analysis');
    if ('entities' in result) {
      expect(result.entities?.symbolName).toBe('refine_edge_points');
    }
  });

  // TC-UT-IE-018: 相似度匹配英文同义表达
  it('should recognize paraphrased find_definition via similarity', () => {
    const result = parse('locate the definition of refundOrder');
    expect('intentType' in result && result.intentType).toBe('find_definition');
    if ('entities' in result) {
      expect(result.entities?.symbolName).toBe('refundOrder');
    }
  });

  // TC-UT-IE-019: list_symbols 意图
  it('should recognize list_symbols intent', () => {
    const result = parse('列出所有导出的函数');
    expect('intentType' in result && result.intentType).toBe('list_symbols');
    if ('entities' in result) {
      expect(result.entities?.filter?.kind).toBe('function');
      expect(result.entities?.filter?.exportedOnly).toBe(true);
    }
  });

  // TC-UT-IE-020: stats 意图
  it('should recognize stats intent', () => {
    const result = parse('项目代码统计');
    expect('intentType' in result && result.intentType).toBe('stats');
  });

  // TC-UT-IE-021: analytics 最热函数
  it('should recognize analytics intent for most called functions', () => {
    const result = parse('调用次数最多的函数');
    expect('intentType' in result && result.intentType).toBe('analytics');
    if ('entities' in result) {
      expect(result.entities?.subType).toBe('most_called');
    }
  });

  // TC-UT-IE-022: analytics 死代码
  it('should recognize analytics intent for unused exports', () => {
    const result = parse('有哪些未使用的导出');
    expect('intentType' in result && result.intentType).toBe('analytics');
    if ('entities' in result) {
      expect(result.entities?.subType).toBe('unused_exports');
    }
  });

  // TC-UT-IE-023: analytics TODO 扫描
  it('should recognize analytics intent for TODO comments', () => {
    const result = parse('项目里有哪些 TODO');
    expect('intentType' in result && result.intentType).toBe('analytics');
    if ('entities' in result) {
      expect(result.entities?.subType).toBe('todos');
    }
  });

  // TC-UT-IE-024: 光标在函数内 → 推荐 call_graph
  it('TC-UT-IE-024: should recommend call_graph when cursor is in function', () => {
    const ctx = makeCtx({ cursor_symbol: 'processOrder', cursor_symbol_kind: 'function' });
    const result = engine.parse({ source: 'text', text: '分析一下', locale: 'zh-CN' }, ctx);
    expect('intentType' in result && result.intentType).toBe('call_graph');
    if ('entities' in result) {
      expect(result.entities?.symbolName).toBe('processOrder');
      expect(result.context?.implicitParams?.cursorKind).toBe('function');
    }
  });

  // TC-UT-IE-025: 选中代码块 → 推荐 impact_analysis
  it('TC-UT-IE-025: should recommend impact_analysis when code is selected and text is unparseable', () => {
    const ctx = makeCtx({ selected_code: 'function calculateTotal() { return a + b; }' });
    const result = engine.parse({ source: 'text', text: '随便看看', locale: 'zh-CN' }, ctx);
    expect('intentType' in result && result.intentType).toBe('impact_analysis');
    if ('entities' in result) {
      expect(result.entities?.symbolName).toBe('calculateTotal');
      expect(result.context?.implicitParams?.hasSelection).toBe(true);
    }
  });

  // TC-UT-IE-026: 光标在类定义 → 推荐 type_relationships
  it('TC-UT-IE-026: should recommend type_relationships when cursor is in class', () => {
    const ctx = makeCtx({ cursor_symbol: 'PaymentService', cursor_symbol_kind: 'class' });
    const result = engine.parse({ source: 'text', text: '查询一下', locale: 'zh-CN' }, ctx);
    expect('intentType' in result && result.intentType).toBe('type_relationships');
    if ('entities' in result) {
      expect(result.entities?.symbolName).toBe('PaymentService');
      expect(result.context?.implicitParams?.cursorKind).toBe('class');
    }
  });

  // TC-UT-IE-027: 查询含代词 → 替换为上下文符号名
  it('TC-UT-IE-027: should replace pronoun with context symbol name', () => {
    const ctx = makeCtx({ cursor_symbol: 'refundOrder' });
    const result = engine.parse({ source: 'text', text: '这个的调用链路', locale: 'zh-CN' }, ctx);
    expect('intentType' in result && result.intentType).toBe('call_graph');
    if ('entities' in result) {
      expect(result.entities?.symbolName).toBe('refundOrder');
      expect(result.context?.implicitParams?.replacedPronoun).toBe(true);
    }
  });

  // TC-UT-IE-028: 空查询 + 有选中代码 → 推断最合适意图
  it('TC-UT-IE-028: should infer intent from empty query with selected code', () => {
    const ctx = makeCtx({ selected_code: 'class UserService { getUser() {} }' });
    const result = engine.parse({ source: 'text', text: '', locale: 'zh-CN' }, ctx);
    expect('intentType' in result && result.intentType).toBe('type_relationships');
    if ('entities' in result) {
      expect(result.entities?.symbolName).toBe('UserService');
      expect(result.context?.implicitParams?.inferredReason).toBe('selection_contains_type_definition');
    }
  });

  // TC-UT-IE-029: 英文代词 this 替换
  it('TC-UT-IE-029: should replace English pronoun this with context symbol', () => {
    const ctx = makeCtx({ cursor_symbol: 'getUserById' });
    const result = engine.parse({ source: 'text', text: 'where is this defined', locale: 'en-US' }, ctx);
    expect('intentType' in result && result.intentType).toBe('find_definition');
    if ('entities' in result) {
      expect(result.entities?.symbolName).toBe('getUserById');
      expect(result.context?.implicitParams?.replacedPronoun).toBe(true);
    }
  });
  it('should resolve ambiguity by index', () => {
    const candidates = [
      { rawText: 'a', intentType: 'find_definition' as const, confidence: 0.5, entities: {} },
      { rawText: 'b', intentType: 'find_references' as const, confidence: 0.5, entities: {} },
    ];
    const resolved = engine.resolveAmbiguity(candidates, 1);
    expect(resolved.intentType).toBe('find_references');
  });

  const emptyContext = makeCtx();

  // TC-UT-IE-015: type_relationships 实现关系
  it('TC-UT-IE-015: should parse "who implements IUserService"', () => {
    const result = engine.parse({ source: 'text', text: '谁实现了 IUserService', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('type_relationships');
      expect(result.entities.symbolName).toBe('IUserService');
      expect(result.entities.relationshipKind).toBe('implementations');
    }
  });

  // TC-UT-IE-021: 代码评审意图应提取 commit hash
  it('TC-UT-IE-021: should parse code_review intent and extract commit hash', () => {
    const result = engine.parse({ source: 'text', text: '评审 commit abc1234def', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('code_review');
      expect(result.entities.commitHash).toBe('abc1234def');
    }
  });

  // 理解层意图测试
  it('TC-UT-IE-030: should parse recent_changes intent "AI 具体改到哪儿了"', () => {
    const result = engine.parse({ source: 'text', text: 'AI 具体改到哪儿了', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('recent_changes');
    }
  });

  it('TC-UT-IE-031: should parse view_annotated intent for .ts file', () => {
    const result = engine.parse({ source: 'text', text: '查看 src/main.ts', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('view_annotated');
      expect(result.entities.filePath).toBe('src/main.ts');
    }
  });

  it('TC-UT-IE-032: should parse view_annotated intent for .cpp file', () => {
    const result = engine.parse({ source: 'text', text: '看看 engine.cpp', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('view_annotated');
      expect(result.entities.filePath).toBe('engine.cpp');
    }
  });

  it('TC-UT-IE-033: should parse chunk_brief intent "模块简报"', () => {
    const result = engine.parse({ source: 'text', text: '模块简报', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('chunk_brief');
    }
  });

  it('TC-UT-IE-034: should parse confirm_reviewed intent "/confirm symbol"', () => {
    const result = engine.parse({ source: 'text', text: '/confirm refundOrder', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('confirm_reviewed');
      expect(result.entities.symbolName).toBe('refundOrder');
    }
  });

  it('TC-UT-IE-035: should parse prune_conventions intent "列出约定"', () => {
    const result = engine.parse({ source: 'text', text: '列出约定', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('prune_conventions');
    }
  });

  // 扩展能力意图测试
  it('TC-UT-IE-036: should parse code_generation intent "重构 refundOrder 为 async"', () => {
    const result = engine.parse({ source: 'text', text: '重构 refundOrder 为 async', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('code_generation');
      expect(result.entities.symbolName).toBe('refundOrder');
    }
  });

  it('TC-UT-IE-037: should parse cross_domain_debug intent "解析这个错误日志"', () => {
    const result = engine.parse({ source: 'text', text: '解析这个错误日志', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('cross_domain_debug');
    }
  });

  it('TC-UT-IE-038: should parse team_collab_share intent "导出项目索引"', () => {
    const result = engine.parse({ source: 'text', text: '导出项目索引', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('team_collab_share');
    }
  });

  it('TC-UT-IE-039: should parse team_collab_annotate intent "给 refundOrder 添加注释"', () => {
    const result = engine.parse({ source: 'text', text: '给 refundOrder 添加注释 "需要校验"', locale: 'zh-CN' }, emptyContext);
    expect(result).not.toHaveProperty('kind');
    if (!('kind' in result)) {
      expect(result.intentType).toBe('team_collab_annotate');
      expect(result.entities.symbolName).toBe('refundOrder');
      expect(result.entities.content).toBe('需要校验');
    }
  });

  // ==========================================================
  // R2.7 学习闭环测试
  // ==========================================================

  describe('R2.7 feedback learning', () => {
    const originalHome = process.env.HOME;

    beforeAll(() => {
      feedbackTmpDir = mkdtempSync(join(tmpdir(), 'nodus-feedback-test-'));
      process.env.HOME = feedbackTmpDir;
    });

    afterAll(() => {
      process.env.HOME = originalHome;
      if (feedbackTmpDir) rmSync(feedbackTmpDir, { recursive: true, force: true });
    });

    // TC-UT-IE-016: 从 feedback.jsonl 加载有效例句
    it('TC-UT-IE-016: should load valid feedback entries as learned examples', () => {
      const nodusDir = join(feedbackTmpDir, '.nodus');
      mkdirSync(nodusDir, { recursive: true });
      writeFileSync(join(nodusDir, 'feedback.jsonl'), [
        JSON.stringify({ input_text: 'how do I call refundOrder', parsed_intent: 'find_references', actual_intent: 'find_references', parsed_confidence: 0.9 }),
        JSON.stringify({ input_text: 'list all the classes in this project', parsed_intent: 'list_symbols', actual_intent: 'list_symbols', parsed_confidence: 0.92 }),
        JSON.stringify({ input_text: 'show me the stats please', parsed_intent: 'stats', actual_intent: 'stats', parsed_confidence: 0.88 }),
      ].join('\n'));

      const engine = new PatternIntentEngine();
      const count = engine.loadFeedback();
      expect(count).toBe(3);
      expect(engine.getLearnedCount()).toBe(3);
    });

    // TC-UT-IE-017: 重复加载不应增加计数
    it('TC-UT-IE-017: should not add duplicate examples on reload', () => {
      const engine = new PatternIntentEngine();
      engine.loadFeedback();
      const afterSecond = engine.loadFeedback();
      expect(afterSecond).toBe(0);
    });

    // TC-UT-IE-018: 匹配应包含已学习例句
    it('TC-UT-IE-018: matchBySimilarity should consider learned examples', () => {
      const engine = new PatternIntentEngine();
      engine.loadFeedback();

      // "how do I call refundOrder" 应匹配 find_references
      const result = engine.parse(
        { source: 'text', text: 'how do I call refundOrder', locale: 'zh-CN' },
        emptyContext,
      );
      expect(result).not.toHaveProperty('kind');
      if (!('kind' in result)) {
        expect(result.intentType).toBe('find_references');
      }
    });

    // TC-UT-IE-019: invalid feedback entries should be skipped
    it('TC-UT-IE-019: should skip invalid feedback entries', () => {
      const nodusDir = join(feedbackTmpDir, '.nodus');
      writeFileSync(join(nodusDir, 'feedback.jsonl'), [
        'invalid json',
        JSON.stringify({ input_text: 'good query here', parsed_intent: 'find_definition', parsed_confidence: 0.9 }),
        JSON.stringify({ no_input: true }),
      ].join('\n'));

      const engine = new PatternIntentEngine();
      const count = engine.loadFeedback();
      expect(count).toBe(1); // 只有 good query here 有效
    });

    // TC-UT-IE-020: 空反馈文件不应报错
    it('TC-UT-IE-020: should handle empty feedback file gracefully', () => {
      const nodusDir = join(feedbackTmpDir, '.nodus');
      writeFileSync(join(nodusDir, 'feedback.jsonl'), '');

      const engine = new PatternIntentEngine();
      const count = engine.loadFeedback();
      expect(count).toBe(0);
    });
  });
});
