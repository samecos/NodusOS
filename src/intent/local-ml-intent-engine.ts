// ============================================================
// LocalMLIntentEngine — 纯 JS 轻量神经网络意图分类器
// 2-3 层前馈网络 + 词袋 + n-gram 特征，~100KB 参数，延迟 <200ms
// 与 PatternIntentEngine 组合使用：模式匹配为快速路径，NN 为回退
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IntentEngine, IntentInput, QueryIntent, IntentEntity, IntentError, Context,
} from './intent-engine.js';
import type { IntentType } from '../common/types.js';
import { PatternIntentEngine } from './intent-engine.impl.js';

// ---- 超参数 ----
const MAX_VOCAB_SIZE = 220;        // 输入特征维度上限
const HIDDEN_SIZE = 24;             // 隐藏层大小
const OUTPUT_SIZE = 10;             // 意图类别数
const LEARNING_RATE = 0.1;          // SGD 学习率
const MOMENTUM = 0.9;               // SGD 动量
const EPOCHS = 5;                   // 增量训练 epoch 数
const MIN_CONFIDENCE = 0.55;        // NN 最低置信度阈值
const AMBIGUOUS_THRESHOLD = 0.35;   // 低于此值返回 ambiguous
const PATTERN_FALLBACK_THRESHOLD = 0.75; // Pattern 结果低于此值时尝试 NN

const INTENT_TYPES: IntentType[] = [
  'find_definition', 'find_references', 'call_graph', 'impact_analysis',
  'change_history', 'symbol_overview', 'list_symbols', 'stats',
  'analytics', 'type_relationships',
];

// 固定关键词特征（不依赖训练数据，增强鲁棒性）
const KEYWORD_FEATURES: Array<{ tokens: string[]; intent: IntentType }> = [
  // find_definition
  { tokens: ['定义', 'defined', 'definition', 'define', 'declare', 'declaration', '声明', '在哪'], intent: 'find_definition' },
  // find_references
  { tokens: ['引用', 'references', 'referenced', 'called', '调用', '谁调', '哪里用', 'uses'], intent: 'find_references' },
  // call_graph
  { tokens: ['链路', '链路', 'graph', 'chain', '调用链', '路径', 'path', 'trace'], intent: 'call_graph' },
  // impact_analysis
  { tokens: ['影响', 'impact', 'affected', 'break', '改动', '修改', 'change', '改', '变了'], intent: 'impact_analysis' },
  // change_history
  { tokens: ['变更', 'history', 'changed', 'modified', 'recent', 'commit', '最近', '改了', 'log'], intent: 'change_history' },
  // symbol_overview
  { tokens: ['overview', '有哪些', 'symbols', 'functions', 'exports', 'contain', '里面', '导出'], intent: 'symbol_overview' },
  // list_symbols
  { tokens: ['列出', 'list', 'all', 'show', '枚举', '全部'], intent: 'list_symbols' },
  // stats
  { tokens: ['统计', 'stats', 'statistics', 'count', '数量', 'metrics', 'overview'], intent: 'stats' },
  // analytics
  { tokens: ['分析', 'analytics', 'hotspot', 'complexity', '耦合', 'todo', 'fixme', '复杂度', '热点', '最多'], intent: 'analytics' },
  // type_relationships
  { tokens: ['继承', '实现', 'implements', 'extends', 'subclass', '类型', 'interface', 'relationship'], intent: 'type_relationships' },
];

interface ModelWeights {
  inputSize: number;
  hiddenSize: number;
  outputSize: number;
  vocab: string[];                  // 词汇表（按索引顺序）
  w1: number[][];                   // [inputSize][hiddenSize]
  b1: number[];                     // [hiddenSize]
  w2: number[][];                   // [hiddenSize][outputSize]
  b2: number[];                     // [outputSize]
  trainedSamples: number;
  trainedHashes: string[];            // 已训练过的样本指纹
  version: number;
}

interface FeedbackEntry {
  input_text?: string;
  parsed_intent?: string;
  actual_intent?: string;
  parsed_confidence?: number;
  actual_entities?: Record<string, unknown>;
}

/** 提取字符 n-gram 与词 token */
function extractTokens(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase().trim();

  // 字符 bigram（对中文/缩写/拼写错误鲁棒）
  for (let i = 0; i < lower.length - 1; i++) {
    tokens.push(lower.slice(i, i + 2));
  }

  // 字符 trigram
  for (let i = 0; i < lower.length - 2; i++) {
    tokens.push(lower.slice(i, i + 3));
  }

  // 英文单词与标识符（保留占位符，让模型聚焦意图词）
  const words = lower.match(/[a-z][a-z0-9_]*/g) ?? [];
  for (const w of words) {
    if (w.length > 1) tokens.push(w);
  }

  // 中文词（连续中文字符作为整体）
  const chinese = lower.match(/[\u4e00-\u9fa5]{2,4}/g) ?? [];
  for (const w of chinese) tokens.push(w);

  return tokens;
}

/** 初始化 Xavier 权重 */
function initWeight(rows: number, cols: number): number[][] {
  const scale = Math.sqrt(2.0 / (rows + cols));
  const mat: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      row.push((Math.random() * 2 - 1) * scale);
    }
    mat.push(row);
  }
  return mat;
}

function initVector(size: number): number[] {
  return Array.from({ length: size }, () => 0);
}

function relu(x: number): number {
  return Math.max(0, x);
}

function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map(v => Math.exp(v - maxLogit));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => v / sumExp);
}

/** 从文本构建特征向量 */
function buildFeatureVector(text: string, vocab: Map<string, number>, inputSize: number): number[] {
  const vec = new Array(inputSize).fill(0);
  const tokens = extractTokens(text);

  for (const t of tokens) {
    const idx = vocab.get(t);
    if (idx !== undefined && idx < inputSize) {
      vec[idx] += 1;
    }
  }

  // 归一化
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }

  // 添加关键词指示特征（放在 vocab 之后）
  const keywordStart = Math.max(0, vocab.size);
  for (let k = 0; k < KEYWORD_FEATURES.length; k++) {
    const kw = KEYWORD_FEATURES[k];
    const hasKw = kw.tokens.some(t => text.toLowerCase().includes(t.toLowerCase()));
    if (hasKw && keywordStart + k < inputSize) {
      vec[keywordStart + k] = 1;
    }
  }

  return vec;
}

/** 前向传播 */
function forward(
  x: number[],
  w1: number[][], b1: number[],
  w2: number[][], b2: number[],
): {
    hidden: number[];
    output: number[];
    probs: number[];
  } {
  const hiddenSize = b1.length;
  const outputSize = b2.length;

  const hidden: number[] = new Array(hiddenSize);
  for (let j = 0; j < hiddenSize; j++) {
    let sum = b1[j];
    for (let i = 0; i < x.length; i++) {
      sum += x[i] * w1[i][j];
    }
    hidden[j] = relu(sum);
  }

  const output: number[] = new Array(outputSize);
  for (let k = 0; k < outputSize; k++) {
    let sum = b2[k];
    for (let j = 0; j < hiddenSize; j++) {
      sum += hidden[j] * w2[j][k];
    }
    output[k] = sum;
  }

  const probs = softmax(output);
  return { hidden, output, probs };
}

/** SGD 单步反向传播，返回梯度范数 */
function backward(
  x: number[], y: number, // y: 目标类别索引
  w1: number[][], b1: number[], w2: number[][], b2: number[],
  dw1: number[][], db1: number[], dw2: number[][], db2: number[],
): number {
  const { hidden, probs } = forward(x, w1, b1, w2, b2);
  const outputSize = b2.length;
  const hiddenSize = b1.length;
  const inputSize = x.length;

  // 输出层梯度 (softmax + cross-entropy)
  const dOut: number[] = new Array(outputSize);
  for (let k = 0; k < outputSize; k++) {
    dOut[k] = probs[k] - (k === y ? 1 : 0);
  }

  // 隐藏层梯度
  const dHidden: number[] = new Array(hiddenSize);
  for (let j = 0; j < hiddenSize; j++) {
    let sum = 0;
    for (let k = 0; k < outputSize; k++) {
      sum += dOut[k] * w2[j][k];
    }
    dHidden[j] = hidden[j] > 0 ? sum : 0; // ReLU derivative
  }

  // 累加梯度
  for (let j = 0; j < hiddenSize; j++) {
    for (let k = 0; k < outputSize; k++) {
      dw2[j][k] += dOut[k] * hidden[j];
    }
  }
  for (let k = 0; k < outputSize; k++) {
    db2[k] += dOut[k];
  }

  for (let i = 0; i < inputSize; i++) {
    for (let j = 0; j < hiddenSize; j++) {
      dw1[i][j] += dHidden[j] * x[i];
    }
  }
  for (let j = 0; j < hiddenSize; j++) {
    db1[j] += dHidden[j];
  }

  // 返回梯度范数（用于监控）
  let gradNorm = 0;
  for (const row of dw1) for (const v of row) gradNorm += v * v;
  for (const v of db1) gradNorm += v * v;
  for (const row of dw2) for (const v of row) gradNorm += v * v;
  for (const v of db2) gradNorm += v * v;
  return Math.sqrt(gradNorm);
}

/** 应用动量梯度下降 */
function applyMomentum(
  w1: number[][], b1: number[], w2: number[][], b2: number[],
  dw1: number[][], db1: number[], dw2: number[][], db2: number[],
  vw1: number[][], vb1: number[], vw2: number[][], vb2: number[],
  lr: number, momentum: number,
): void {
  const hiddenSize = b1.length;
  const outputSize = b2.length;
  const inputSize = w1.length;

  for (let i = 0; i < inputSize; i++) {
    for (let j = 0; j < hiddenSize; j++) {
      vw1[i][j] = momentum * vw1[i][j] + dw1[i][j];
      w1[i][j] -= lr * vw1[i][j];
    }
  }
  for (let j = 0; j < hiddenSize; j++) {
    vb1[j] = momentum * vb1[j] + db1[j];
    b1[j] -= lr * vb1[j];
  }
  for (let j = 0; j < hiddenSize; j++) {
    for (let k = 0; k < outputSize; k++) {
      vw2[j][k] = momentum * vw2[j][k] + dw2[j][k];
      w2[j][k] -= lr * vw2[j][k];
    }
  }
  for (let k = 0; k < outputSize; k++) {
    vb2[k] = momentum * vb2[k] + db2[k];
    b2[k] -= lr * vb2[k];
  }
}

// ============================================================
// LocalMLIntentEngine
// ============================================================

export class LocalMLIntentEngine implements IntentEngine {
  private patternEngine: PatternIntentEngine;

  // 神经网络参数
  private vocab = new Map<string, number>();
  private inputSize = 0;
  private readonly hiddenSize = HIDDEN_SIZE;
  private readonly outputSize = OUTPUT_SIZE;

  private w1: number[][] = [];
  private b1: number[] = [];
  private w2: number[][] = [];
  private b2: number[] = [];

  // 动量缓存
  private vw1: number[][] = [];
  private vb1: number[] = [];
  private vw2: number[][] = [];
  private vb2: number[] = [];

  private modelPath: string;
  private trainedSamples = 0;
  private learnedCount = 0;
  private trainedHashes = new Set<string>(); // 去重：已训练过的 (text|intent) 指纹

  constructor(modelPath?: string) {
    this.patternEngine = new PatternIntentEngine();

    const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    this.modelPath = modelPath ?? join(home, '.nodus', 'ml-intent-model.json');

    this.initVocab();
    this.inputSize = this.vocab.size + KEYWORD_FEATURES.length;

    if (!this.loadModel()) {
      this.initWeights();
    }
  }

  // ---- 初始化 ----

  private initVocab(): void {
    // 从内置例句 + 常见意图关键词构建基础词汇表
    const allTexts: string[] = [];

    // 内置例句（来自 PatternIntentEngine 的 exampleQueries）
    const builtIns = [
      'xxx在哪里定义的', 'xxx的定义', 'where is xxx defined', 'find xxx', 'locate the definition of xxx',
      'xxx被哪些地方调用了', 'xxx的引用', 'who calls xxx', 'references to xxx',
      'xxx的调用链路', 'xxx的调用链', 'call graph of xxx',
      '如果我改了xxx哪些文件会受影响', '改动xxx会影响哪些地方', 'xxx的影响范围', 'what would break if i change xxx', 'impact analysis of xxx',
      'xxx模块最近一周改了什么', 'xxx最近有什么变更', 'change history of xxx',
      'xxx里有哪些函数', 'xxx里有哪些符号', 'list symbols in xxx',
      '列出所有函数', '列出所有导出符号', 'list all functions', 'show all exports in xxx',
      '代码统计', '项目统计', 'statistics', 'how many functions are there',
      '调用次数最多的函数', '影响范围最大的函数', '哪些导出没被使用', '模块耦合度', '最长调用链', '入口函数', 'TODO 列表', '复杂度最高的函数', '变更热点文件',
      '谁实现了 xxx', 'xxx 有哪些实现', '哪些类继承了 xxx', '哪些类型使用了 xxx', 'who implements xxx', 'subclasses of xxx',
    ];
    allTexts.push(...builtIns);

    // 关键词扩展
    for (const kw of KEYWORD_FEATURES) {
      allTexts.push(...kw.tokens);
    }

    // 统计 token 频率
    const freq = new Map<string, number>();
    for (const text of allTexts) {
      for (const t of extractTokens(text)) {
        freq.set(t, (freq.get(t) ?? 0) + 1);
      }
    }

    // 按频率排序，取前 MAX_VOCAB_SIZE 个
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_VOCAB_SIZE);
    this.vocab = new Map(sorted.map(([t], i) => [t, i]));
  }

  private initWeights(): void {
    this.w1 = initWeight(this.inputSize, this.hiddenSize);
    this.b1 = initVector(this.hiddenSize);
    this.w2 = initWeight(this.hiddenSize, this.outputSize);
    this.b2 = initVector(this.outputSize);

    this.vw1 = initWeight(this.inputSize, this.hiddenSize).map(r => r.map(() => 0));
    this.vb1 = initVector(this.hiddenSize);
    this.vw2 = initWeight(this.hiddenSize, this.outputSize).map(r => r.map(() => 0));
    this.vb2 = initVector(this.outputSize);

    this.trainedSamples = 0;
  }

  // ---- 模型持久化 ----

  saveModel(): void {
    try {
      const weights: ModelWeights = {
        inputSize: this.inputSize,
        hiddenSize: this.hiddenSize,
        outputSize: this.outputSize,
        vocab: [...this.vocab.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t),
        w1: this.w1,
        b1: this.b1,
        w2: this.w2,
        b2: this.b2,
        trainedSamples: this.trainedSamples,
        trainedHashes: [...this.trainedHashes],
        version: 1,
      };
      const dir = this.modelPath.substring(0, this.modelPath.lastIndexOf('/'));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.modelPath, JSON.stringify(weights), 'utf-8');
    } catch {
      // 静默失败 — 模型持久化不影响主流程
    }
  }

  loadModel(): boolean {
    try {
      if (!existsSync(this.modelPath)) return false;
      const raw = readFileSync(this.modelPath, 'utf-8');
      const data = JSON.parse(raw) as ModelWeights;

      if (data.version !== 1 || data.hiddenSize !== this.hiddenSize || data.outputSize !== this.outputSize) {
        return false;
      }

      this.inputSize = data.inputSize;
      this.vocab = new Map(data.vocab.map((t, i) => [t, i]));
      this.w1 = data.w1;
      this.b1 = data.b1;
      this.w2 = data.w2;
      this.b2 = data.b2;
      this.trainedSamples = data.trainedSamples ?? 0;
      this.trainedHashes = new Set(data.trainedHashes ?? []);

      // 重置动量
      this.vw1 = initWeight(this.inputSize, this.hiddenSize).map(r => r.map(() => 0));
      this.vb1 = initVector(this.hiddenSize);
      this.vw2 = initWeight(this.hiddenSize, this.outputSize).map(r => r.map(() => 0));
      this.vb2 = initVector(this.outputSize);

      return true;
    } catch {
      return false;
    }
  }

  // ---- 预测 ----

  private predict(text: string): { intentType: IntentType; confidence: number; scores: Record<string, number> } {
    const x = buildFeatureVector(text, this.vocab, this.inputSize);
    const { probs } = forward(x, this.w1, this.b1, this.w2, this.b2);

    let bestIdx = 0;
    let bestProb = probs[0];
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > bestProb) {
        bestProb = probs[i];
        bestIdx = i;
      }
    }

    const scores: Record<string, number> = {};
    for (let i = 0; i < INTENT_TYPES.length; i++) {
      scores[INTENT_TYPES[i]] = probs[i];
    }

    return { intentType: INTENT_TYPES[bestIdx], confidence: bestProb, scores };
  }

  // ---- IntentEngine 接口 ----

  parse(input: IntentInput, context: Context): QueryIntent | IntentError {
    const text = input.text.trim();
    if (!text) return { kind: 'empty_input' };

    // 1. 快速路径：PatternIntentEngine
    const patternResult = this.patternEngine.parse(input, context);

    // 如果 Pattern 直接给出高置信度结果，直接返回（快速路径）
    if (!('kind' in patternResult) && patternResult.confidence >= PATTERN_FALLBACK_THRESHOLD) {
      return patternResult;
    }

    // 2. 如果 Pattern 给出低置信度或 ambiguous，尝试 NN 回退
    const nnResult = this.predict(text);

    // 3. 组合决策
    if (!('kind' in patternResult)) {
      // Pattern 有结果但置信度低
      const candidates: QueryIntent[] = [patternResult];

      if (nnResult.confidence >= MIN_CONFIDENCE) {
        // NN 更自信，以 NN 为主，Pattern 作为候选
        const nnIntent = this.makeIntent(text, nnResult.intentType, nnResult.confidence, context);
        candidates.unshift(nnIntent);

        // 如果两者一致，提升置信度
        if (patternResult.intentType === nnResult.intentType) {
          return this.makeIntent(text, nnResult.intentType, Math.min(0.95, nnResult.confidence + 0.1), context);
        }

        // 如果 NN 置信度足够高，优先 NN
        if (nnResult.confidence >= 0.75) {
          return nnIntent;
        }

        return { kind: 'ambiguous', candidates };
      }

      // NN 置信度低，但 Pattern 至少给出了结果，返回 Pattern 结果（降低置信度）
      return this.makeIntent(text, patternResult.intentType, patternResult.confidence * 0.9, context);
    }

    // Pattern 完全无法解析（unparseable 或 empty_input）
    if (nnResult.confidence >= MIN_CONFIDENCE) {
      return this.makeIntent(text, nnResult.intentType, nnResult.confidence, context);
    }
    if (nnResult.confidence >= AMBIGUOUS_THRESHOLD) {
      return { kind: 'ambiguous', candidates: [this.makeIntent(text, nnResult.intentType, nnResult.confidence, context)] };
    }

    return { kind: 'unparseable', rawText: text };
  }

  private makeIntent(rawText: string, intentType: IntentType, confidence: number, context: Context): QueryIntent {
    const entities = this.extractEntities(rawText, intentType, context);
    return { rawText, intentType, confidence, entities };
  }

  private extractEntities(rawText: string, intentType: IntentType, context: Context): IntentEntity {
    // 复用 PatternIntentEngine 的实体提取能力（通过内部调用）
    // 这里直接手动实现核心实体提取，保持轻量
    const entities: IntentEntity = {};
    const lower = rawText.toLowerCase();

    // 符号名提取
    const commonWords = new Set([
      'the', 'of', 'is', 'where', 'find', 'show', 'look', 'up', 'who', 'calls',
      'references', 'to', 'call', 'graph', 'chain', 'impact', 'analysis', 'affected',
      'files', 'what', 'would', 'break', 'if', 'i', 'change', 'locate', 'definition',
      'module', 'symbols', 'functions', 'exports', 'in', 'for', 'a', 'an', 'and',
      'or', 'how', 'does', 'are', 'there', 'any', 'recent', 'changes', 'history',
      '列出', '所有', '代码', '项目', '统计', '分析', '调用', '定义', '引用', '影响',
      '变更', '历史', '最近', '改了', '哪些', '什么', '哪里', '怎么', '有多少',
    ]);

    const matches = rawText.match(/\b[a-zA-Z_]\w{1,40}\b/g) ?? [];
    const candidates = matches.filter(w => !commonWords.has(w.toLowerCase()));
    let symbolName: string | undefined;
    if (candidates.length > 0) {
      const scored = candidates.map(w => ({
        word: w,
        score: w.length + (w.includes('_') ? 5 : 0) + (/[a-z][A-Z]/.test(w) ? 3 : 0),
      }));
      scored.sort((a, b) => b.score - a.score);
      symbolName = scored[0].word;
    }

    if (symbolName) {
      if (intentType === 'find_definition' || intentType === 'find_references' ||
          intentType === 'call_graph' || intentType === 'impact_analysis' ||
          intentType === 'type_relationships') {
        entities.symbolName = symbolName;
      }
    }

    // 文件路径
    const fileMatch = rawText.match(/([a-zA-Z_][\w/.-]*\.(ts|tsx|js|jsx|py|service\.ts|component\.tsx))/);
    if (fileMatch) entities.filePath = fileMatch[1];

    // 模块名
    const moduleMatch = rawText.match(/(?:模块\s*)?([a-zA-Z_]\w+)(?:\s*模块)/);
    if (moduleMatch) entities.moduleName = moduleMatch[1];

    // 时间范围
    if (/最近|这周|过去.?周|last\s+week|this\s+week|recent/i.test(lower)) {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      entities.timeRange = { from, to: now };
    } else if (/这个月|本月|this\s+month/i.test(lower)) {
      const now = new Date();
      entities.timeRange = { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    }

    // analytics 子类型
    if (intentType === 'analytics') {
      if (/调用次数最多|最热|most called|top called/.test(lower)) entities.subType = 'most_called';
      else if (/影响范围最大|most impactful/.test(lower)) entities.subType = 'most_impactful';
      else if (/未使用|没用|死代码|unused|dead/.test(lower)) entities.subType = 'unused_exports';
      else if (/模块耦合|耦合度|most coupled|module coupling/.test(lower)) entities.subType = 'coupled_modules';
      else if (/最长调用链|longest call chain/.test(lower)) entities.subType = 'longest_chains';
      else if (/入口|entry points?|entry functions?/.test(lower)) entities.subType = 'entry_points';
      else if (/todo|fixme|hack|待办|备忘/.test(lower)) entities.subType = 'todos';
      else if (/复杂度最高|最复杂|most complex|complexity/.test(lower)) entities.subType = 'complexity';
      else if (/变更热点|最热文件|most changed|change heat|changed files/.test(lower)) entities.subType = 'most_changed';
    }

    // 类型关系
    if (intentType === 'type_relationships') {
      if (/实现|implements?/.test(lower)) entities.relationshipKind = 'implementations';
      else if (/继承|extends?|子类|subclasses?/.test(lower)) entities.relationshipKind = 'subclasses';
      else if (/使用|uses?|引用|type\s+uses?/.test(lower)) entities.relationshipKind = 'type_uses';
    }

    // list_symbols 过滤
    if (intentType === 'list_symbols') {
      const filter: NonNullable<IntentEntity['filter']> = {};
      if (/函数|functions?/.test(lower)) filter.kind = 'function';
      else if (/类|classes?/.test(lower)) filter.kind = 'class';
      else if (/接口|interfaces?/.test(lower)) filter.kind = 'interface';
      else if (/方法|methods?/.test(lower)) filter.kind = 'method';
      if (/导出|exported|exports?/.test(lower)) filter.exportedOnly = true;
      if (fileMatch) filter.filePath = fileMatch[1];
      const modPath = rawText.match(/(?:src\/|app\/|lib\/)([a-zA-Z_][\w/]+)/);
      if (modPath) filter.modulePath = modPath[0];
      if (Object.keys(filter).length > 0) entities.filter = filter;
    }

    // 上下文补全
    if (!entities.symbolName && context.cursor_symbol) {
      entities.symbolName = context.cursor_symbol;
    }
    if (!entities.filePath && context.active_file) {
      entities.filePath = context.active_file;
    }

    return entities;
  }

  resolveAmbiguity(candidates: QueryIntent[], chosenIndex: number): QueryIntent {
    return candidates[chosenIndex]!;
  }

  recordFeedback(input: IntentInput, parsed: QueryIntent | null, actual: QueryIntent): void {
    // 同时记录到 PatternIntentEngine 的 feedback.jsonl
    this.patternEngine.recordFeedback(input, parsed, actual);
  }

  loadFeedback(): number {
    // 1. 让 PatternIntentEngine 也加载反馈（用于相似度匹配）
    this.patternEngine.loadFeedback();

    // 2. 从 feedback.jsonl 读取训练数据，执行增量训练（过滤已训练样本）
    const samples = this.readFeedbackSamples();
    if (samples.length === 0) return 0;

    const prevCount = this.trainedSamples;
    this.train(samples);
    this.trainedSamples += samples.length;
    this.learnedCount += samples.length;

    // 保存模型
    this.saveModel();

    return this.trainedSamples - prevCount;
  }

  getLearnedCount(): number {
    return this.learnedCount + this.patternEngine.getLearnedCount();
  }

  // ---- 训练 ----

  private readFeedbackSamples(): Array<{ text: string; intentType: IntentType }> {
    try {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
      const filePath = join(home, '.nodus', 'feedback.jsonl');
      if (!existsSync(filePath)) return [];

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      if (lines.length === 0) return [];

      const samples: Array<{ text: string; intentType: IntentType }> = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as FeedbackEntry;
          const text = entry.input_text?.trim();
          const intent = (entry.actual_intent ?? entry.parsed_intent) as IntentType | undefined;
          if (!text || !intent) continue;
          if (!this.isValidIntentType(intent)) continue;

          const key = `${text}|${intent}`;
          // 全局去重：已训练过或已加入本次队列
          if (this.trainedHashes.has(key)) continue;
          this.trainedHashes.add(key);

          samples.push({ text, intentType: intent });
        } catch {
          // 跳过无效行
        }
      }

      return samples;
    } catch {
      return [];
    }
  }

  /** 增量训练：对新样本执行若干 epoch SGD */
  train(samples: Array<{ text: string; intentType: IntentType }>): void {
    if (samples.length === 0) return;

    // 构建训练数据
    const data = samples.map(s => ({
      x: buildFeatureVector(s.text, this.vocab, this.inputSize),
      y: INTENT_TYPES.indexOf(s.intentType),
    }));

    const batchSize = Math.min(32, data.length);

    for (let epoch = 0; epoch < EPOCHS; epoch++) {
      // 随机打乱
      for (let i = data.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [data[i], data[j]] = [data[j], data[i]];
      }

      // 小批量梯度下降
      for (let batchStart = 0; batchStart < data.length; batchStart += batchSize) {
        const batch = data.slice(batchStart, batchStart + batchSize);

        // 初始化梯度累加器
        const dw1 = initWeight(this.inputSize, this.hiddenSize).map(r => r.map(() => 0));
        const db1 = initVector(this.hiddenSize);
        const dw2 = initWeight(this.hiddenSize, this.outputSize).map(r => r.map(() => 0));
        const db2 = initVector(this.outputSize);

        // 计算梯度
        for (const item of batch) {
          backward(item.x, item.y, this.w1, this.b1, this.w2, this.b2, dw1, db1, dw2, db2);
        }

        // 梯度平均
        for (let i = 0; i < this.inputSize; i++) {
          for (let j = 0; j < this.hiddenSize; j++) dw1[i][j] /= batch.length;
        }
        for (let j = 0; j < this.hiddenSize; j++) db1[j] /= batch.length;
        for (let j = 0; j < this.hiddenSize; j++) {
          for (let k = 0; k < this.outputSize; k++) dw2[j][k] /= batch.length;
        }
        for (let k = 0; k < this.outputSize; k++) db2[k] /= batch.length;

        // 应用动量更新
        applyMomentum(
          this.w1, this.b1, this.w2, this.b2,
          dw1, db1, dw2, db2,
          this.vw1, this.vb1, this.vw2, this.vb2,
          LEARNING_RATE, MOMENTUM,
        );
      }
    }
  }

  private isValidIntentType(type: string): boolean {
    return (INTENT_TYPES as string[]).includes(type);
  }

  // ---- 公开辅助方法（用于测试和诊断） ----

  /** 返回模型参数总量估算（字节数） */
  getModelSize(): number {
    const vocabChars = [...this.vocab.keys()].reduce((sum, t) => sum + t.length + 4, 0); // +4 for JSON quotes/comma
    const weightChars =
      (this.inputSize * this.hiddenSize + this.hiddenSize + this.hiddenSize * this.outputSize + this.outputSize) * 12;
    const hashChars = [...this.trainedHashes].reduce((sum, h) => sum + h.length + 4, 0);
    return vocabChars + weightChars + hashChars + 512; // 512 for JSON structural overhead
  }

  /** 返回当前词汇表大小 */
  getVocabSize(): number {
    return this.vocab.size;
  }

  /** 返回已训练样本数 */
  getTrainedSamples(): number {
    return this.trainedSamples;
  }

  /** 返回指定文本的 NN 原始预测概率分布 */
  getPredictionScores(text: string): Record<string, number> {
    return this.predict(text).scores;
  }
}
