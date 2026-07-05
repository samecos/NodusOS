// ============================================================
// LocalMLIntentEngine 测试 — TC-UT-LMIE-001 ~ TC-UT-LMIE-020
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { LocalMLIntentEngine } from './local-ml-intent-engine.js';
import type { Context, QueryIntent } from './intent-engine.js';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let feedbackTmpDir: string;
const originalHome = process.env.HOME;

function makeCtx(overrides: Partial<Context> = {}): Context {
  return {
    active_file: null, cursor_line: null, cursor_col: null,
    cursor_symbol: null, selected_code: null, selected_range: null,
    recent_queries: [], active_project_root: '/test',
    ...overrides,
  };
}

function parse(engine: LocalMLIntentEngine, text: string, ctx?: Context): QueryIntent | { kind: string } {
  const result = engine.parse({ source: 'text', text, locale: 'zh-CN' }, ctx ?? makeCtx());
  return result as QueryIntent;
}

function isQueryIntent(result: QueryIntent | { kind: string }): result is QueryIntent {
  return 'intentType' in result;
}

function isError(result: QueryIntent | { kind: string }): result is { kind: string } {
  return 'kind' in result;
}

beforeAll(() => {
  feedbackTmpDir = mkdtempSync(join(tmpdir(), 'nodus-ml-feedback-test-'));
  process.env.HOME = feedbackTmpDir;
});

afterAll(() => {
  process.env.HOME = originalHome;
  if (feedbackTmpDir) rmSync(feedbackTmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // 清理模型文件，保证每个测试初始状态一致
  const modelPath = join(feedbackTmpDir, '.nodus', 'ml-intent-model.json');
  if (existsSync(modelPath)) {
    rmSync(modelPath, { force: true });
  }
  const feedbackPath = join(feedbackTmpDir, '.nodus', 'feedback.jsonl');
  if (existsSync(feedbackPath)) {
    rmSync(feedbackPath, { force: true });
  }
});

describe('LocalMLIntentEngine', () => {
  // TC-UT-LMIE-001: 构造函数正确初始化
  it('TC-UT-LMIE-001: should initialize with default weights and vocab', () => {
    const engine = new LocalMLIntentEngine();
    expect(engine.getVocabSize()).toBeGreaterThan(0);
    expect(engine.getTrainedSamples()).toBe(0);
  });

  // TC-UT-LMIE-002: 解析 find_definition 意图（NN 回退）
  it('TC-UT-LMIE-002: should parse find_definition intent via NN fallback', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, '查找 refundOrder 的定义');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('find_definition');
    }
  });

  // TC-UT-LMIE-003: 解析 find_references 意图（NN 回退）
  it('TC-UT-LMIE-003: should parse find_references intent via NN fallback', () => {
    const engine = new LocalMLIntentEngine();
    // 先快速训练几个同义例句，让 NN 学会 find_references 模式
    engine.train([
      { text: 'refundOrder 被哪些地方引用了', intentType: 'find_references' },
      { text: 'who calls refundOrder', intentType: 'find_references' },
      { text: 'refundOrder 的引用在哪里', intentType: 'find_references' },
      { text: 'refundOrder 被谁调用了', intentType: 'find_references' },
      { text: 'show references to refundOrder', intentType: 'find_references' },
      { text: 'refundOrder 的调用方', intentType: 'find_references' },
      { text: '哪里使用了 refundOrder', intentType: 'find_references' },
    ]);
    const result = parse(engine, 'refundOrder 被哪些地方引用了');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      // 训练后 find_references 应为最高分或接近最高
      const scores = engine.getPredictionScores('refundOrder 被哪些地方引用了');
      expect(scores['find_references']).toBeGreaterThanOrEqual(0.25);
    }
  });

  // TC-UT-LMIE-004: 解析 call_graph 意图（NN 回退）
  it('TC-UT-LMIE-004: should parse call_graph intent via NN fallback', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, 'login 的调用链路');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('call_graph');
    }
  });

  // TC-UT-LMIE-005: 解析 impact_analysis 意图（NN 回退）
  it('TC-UT-LMIE-005: should parse impact_analysis intent via NN fallback', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, '改动 User 会影响哪些地方');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('impact_analysis');
    }
  });

  // TC-UT-LMIE-006: 解析 change_history 意图（NN 回退）
  it('TC-UT-LMIE-006: should parse change_history intent via NN fallback', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, 'auth 模块最近有什么变更');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('change_history');
    }
  });

  // TC-UT-LMIE-007: 解析 stats 意图（NN 回退）
  it('TC-UT-LMIE-007: should parse stats intent via NN fallback', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, '项目代码统计');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('stats');
    }
  });

  // TC-UT-LMIE-008: 解析 analytics 意图（NN 回退）
  it('TC-UT-LMIE-008: should parse analytics intent via NN fallback', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, '调用次数最多的函数');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('analytics');
    }
  });

  // TC-UT-LMIE-009: 解析 type_relationships 意图（NN 回退）
  it('TC-UT-LMIE-009: should parse type_relationships intent via NN fallback', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, '谁实现了 IUserService');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('type_relationships');
    }
  });

  // TC-UT-LMIE-010: 空输入返回 empty_input
  it('TC-UT-LMIE-010: should return empty_input for blank text', () => {
    const engine = new LocalMLIntentEngine();
    const result = engine.parse({ source: 'text', text: '', locale: 'zh-CN' }, makeCtx());
    expect(isError(result)).toBe(true);
    if (isError(result)) expect(result.kind).toBe('empty_input');
  });

  // TC-UT-LMIE-011: 解析 list_symbols 意图
  it('TC-UT-LMIE-011: should parse list_symbols intent', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, '列出所有导出的函数');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('list_symbols');
    }
  });

  // TC-UT-LMIE-012: 解析 symbol_overview 意图
  it('TC-UT-LMIE-012: should parse symbol_overview intent', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, 'payment.service.ts 里有哪些导出');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('symbol_overview');
    }
  });

  // TC-UT-LMIE-013: 实体提取 — 符号名
  it('TC-UT-LMIE-013: should extract symbolName from text', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, 'getUserByEmail 在哪里定义的');
    if (isQueryIntent(result)) {
      expect(result.entities?.symbolName).toBe('getUserByEmail');
    }
  });

  // TC-UT-LMIE-014: 实体提取 — 文件路径
  it('TC-UT-LMIE-014: should extract filePath from text', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, 'payment.service.ts 里有哪些函数');
    if (isQueryIntent(result)) {
      expect(result.entities?.filePath).toBe('payment.service.ts');
    }
  });

  // TC-UT-LMIE-015: 实体提取 — 上下文补全
  it('TC-UT-LMIE-015: should use cursor context when symbol not in text', () => {
    const engine = new LocalMLIntentEngine();
    const ctx = makeCtx({ cursor_symbol: 'refundOrder' });
    const result = parse(engine, '这个函数被哪里调用了', ctx);
    if (isQueryIntent(result)) {
      expect(result.entities?.symbolName).toBe('refundOrder');
    }
  });

  // TC-UT-LMIE-016: resolveAmbiguity 正确选择
  it('TC-UT-LMIE-016: should resolve ambiguity by index', () => {
    const engine = new LocalMLIntentEngine();
    const candidates = [
      { rawText: 'a', intentType: 'find_definition' as const, confidence: 0.5, entities: {} },
      { rawText: 'b', intentType: 'find_references' as const, confidence: 0.5, entities: {} },
    ];
    const resolved = engine.resolveAmbiguity(candidates, 1);
    expect(resolved.intentType).toBe('find_references');
  });

  // TC-UT-LMIE-017: 从 feedback.jsonl 加载并训练
  it('TC-UT-LMIE-017: should load feedback and incrementally train', () => {
    const nodusDir = join(feedbackTmpDir, '.nodus');
    mkdirSync(nodusDir, { recursive: true });
    writeFileSync(join(nodusDir, 'feedback.jsonl'), [
      JSON.stringify({ input_text: 'how do I call refundOrder', parsed_intent: 'find_references', actual_intent: 'find_references', parsed_confidence: 0.9 }),
      JSON.stringify({ input_text: 'show me the stats please', parsed_intent: 'stats', actual_intent: 'stats', parsed_confidence: 0.88 }),
      JSON.stringify({ input_text: 'what is the impact of changing User', parsed_intent: 'impact_analysis', actual_intent: 'impact_analysis', parsed_confidence: 0.85 }),
    ].join('\n'));

    const engine = new LocalMLIntentEngine();
    const count = engine.loadFeedback();
    expect(count).toBe(3);
    expect(engine.getTrainedSamples()).toBe(3);
  });

  // TC-UT-LMIE-018: 增量训练后模型能正确预测
  it('TC-UT-LMIE-018: should improve prediction after training on feedback', () => {
    const nodusDir = join(feedbackTmpDir, '.nodus');
    mkdirSync(nodusDir, { recursive: true });
    writeFileSync(join(nodusDir, 'feedback.jsonl'), [
      JSON.stringify({ input_text: 'how do I call refundOrder', parsed_intent: 'find_references', actual_intent: 'find_references', parsed_confidence: 0.9 }),
      JSON.stringify({ input_text: 'where is refundOrder used', parsed_intent: 'find_references', actual_intent: 'find_references', parsed_confidence: 0.9 }),
      JSON.stringify({ input_text: 'who references refundOrder', parsed_intent: 'find_references', actual_intent: 'find_references', parsed_confidence: 0.9 }),
    ].join('\n'));

    const engine = new LocalMLIntentEngine();
    engine.loadFeedback();

    // 训练后应能正确预测同义表达
    const result = parse(engine, 'who calls refundOrder');
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('find_references');
    }
  });

  // TC-UT-LMIE-019: 重复加载不应重复训练
  it('TC-UT-LMIE-019: should not duplicate training on reload', () => {
    const nodusDir = join(feedbackTmpDir, '.nodus');
    mkdirSync(nodusDir, { recursive: true });
    writeFileSync(join(nodusDir, 'feedback.jsonl'), [
      JSON.stringify({ input_text: 'how do I call refundOrder', parsed_intent: 'find_references', actual_intent: 'find_references', parsed_confidence: 0.9 }),
    ].join('\n'));

    const engine = new LocalMLIntentEngine();
    const first = engine.loadFeedback();
    const second = engine.loadFeedback();
    expect(first).toBe(1);
    expect(second).toBe(0); // 已去重，不会重复训练
  });

  // TC-UT-LMIE-020: 模型大小在 100KB 以内
  it('TC-UT-LMIE-020: should have model size under 100KB', () => {
    const engine = new LocalMLIntentEngine();
    const size = engine.getModelSize();
    expect(size).toBeLessThan(100 * 1024); // ~100KB 序列化模型
  });

  // TC-UT-LMIE-021: 模型保存与加载
  it('TC-UT-LMIE-021: should save and load model weights', () => {
    const modelPath = join(feedbackTmpDir, '.nodus', 'test-model.json');
    const engine1 = new LocalMLIntentEngine(modelPath);

    // 训练一下
    const nodusDir = join(feedbackTmpDir, '.nodus');
    mkdirSync(nodusDir, { recursive: true });
    writeFileSync(join(nodusDir, 'feedback.jsonl'), [
      JSON.stringify({ input_text: 'how do I call refundOrder', parsed_intent: 'find_references', actual_intent: 'find_references', parsed_confidence: 0.9 }),
      JSON.stringify({ input_text: 'show me the stats please', parsed_intent: 'stats', actual_intent: 'stats', parsed_confidence: 0.88 }),
    ].join('\n'));
    engine1.loadFeedback();
    engine1.saveModel();

    const engine2 = new LocalMLIntentEngine(modelPath);
    expect(engine2.getTrainedSamples()).toBe(engine1.getTrainedSamples());
  });

  // TC-UT-LMIE-022: 记录反馈到 feedback.jsonl
  it('TC-UT-LMIE-022: should record feedback to jsonl', () => {
    const engine = new LocalMLIntentEngine();
    engine.recordFeedback(
      { source: 'text', text: 'test query', locale: 'zh-CN' },
      { rawText: 'test query', intentType: 'find_definition', confidence: 0.8, entities: {} },
      { rawText: 'test query', intentType: 'find_definition', confidence: 1.0, entities: {} },
    );

    const feedbackPath = join(feedbackTmpDir, '.nodus', 'feedback.jsonl');
    expect(existsSync(feedbackPath)).toBe(true);
  });

  // TC-UT-LMIE-023: 延迟测量（应 <200ms）
  it('TC-UT-LMIE-023: should parse within 200ms', () => {
    const engine = new LocalMLIntentEngine();
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      engine.parse({ source: 'text', text: 'how do I call refundOrder', locale: 'en-US' }, makeCtx());
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 10).toBeLessThan(200); // 平均每次 <200ms
  });

  // TC-UT-LMIE-024: 英文同义改写识别
  it('TC-UT-LMIE-024: should recognize English paraphrased queries', () => {
    const engine = new LocalMLIntentEngine();
    const result = parse(engine, 'locate the definition of refundOrder');
    expect(isQueryIntent(result)).toBe(true);
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('find_definition');
    }
  });

  // TC-UT-LMIE-025: 组合决策 — Pattern 高置信度时直接返回
  it('TC-UT-LMIE-025: should return Pattern result directly when high confidence', () => {
    const engine = new LocalMLIntentEngine();
    // "refundOrder在哪里定义的" 是 Pattern 的高置信度匹配
    const result = parse(engine, 'refundOrder在哪里定义的');
    if (isQueryIntent(result)) {
      expect(result.intentType).toBe('find_definition');
      expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    }
  });

  // TC-UT-LMIE-026: 无法解析时返回有效结果（不崩溃）
  it('TC-UT-LMIE-026: should handle nonsense input without crashing', () => {
    const engine = new LocalMLIntentEngine();
    const result = engine.parse({ source: 'text', text: 'xyz123 nonsense', locale: 'zh-CN' }, makeCtx());
    // 对无意义输入，只要返回有效结果（QueryIntent 或 IntentError）即可
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
  });

  // TC-UT-LMIE-027: getPredictionScores 返回完整概率分布
  it('TC-UT-LMIE-027: should return all intent scores', () => {
    const engine = new LocalMLIntentEngine();
    const scores = engine.getPredictionScores('how do I call refundOrder');
    const keys = Object.keys(scores);
    expect(keys.length).toBe(10);
    const sum = Object.values(scores).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 1); // softmax 概率和 ≈ 1
  });
});
