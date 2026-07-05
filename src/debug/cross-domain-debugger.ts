// ============================================================
// CrossDomainDebugger — 跨域调试接口
// 解析日志、追踪错误、关联代码位置
// ============================================================

import type { Symbol, SourceLocation } from '../common/types.js';
import type { CodeIntelligence } from '../code-intel/code-intelligence.js';

/** 日志级别 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'unknown';

/** 堆栈帧信息 */
export interface StackFrame {
  filePath: string;
  line: number;
  column?: number;
  functionName?: string;
}

/** 解析后的日志条目 */
export interface LogEntry {
  /** 原始日志行 */
  raw: string;
  /** 时间戳（如果日志中包含） */
  timestamp?: Date;
  /** 日志级别 */
  level: LogLevel;
  /** 提取的消息主体 */
  message: string;
  /** 错误类型（如 TypeError、ReferenceError） */
  errorType?: string;
  /** 从日志行直接提取的文件路径 */
  filePath?: string;
  /** 从日志行直接提取的行号 */
  line?: number;
  /** 从日志行直接提取的列号 */
  column?: number;
  /** 提取的函数名 */
  functionName?: string;
  /** 解析出的堆栈帧列表 */
  stackFrames: StackFrame[];
  /** 是否为结构化日志（JSON 格式） */
  isStructured: boolean;
  /** 结构化日志的原始字段（仅 isStructured=true 时存在） */
  structuredFields?: Record<string, unknown>;
}

/** 错误追踪结果 */
export interface ErrorTrace {
  /** 错误消息 */
  errorMessage: string;
  /** 错误类型 */
  errorType?: string;
  /** 根本原因（从日志链推断） */
  rootCause?: string;
  /** 完整堆栈帧 */
  stackFrames: StackFrame[];
  /** 最可能的源码位置（堆栈顶部或日志中直接提取） */
  primaryLocation?: SourceLocation;
  /** 导致错误的调用链（从底到顶） */
  callChain: StackFrame[];
}

/** 日志与代码关联结果 */
export interface CorrelatedResult {
  /** 原始日志条目 */
  logEntry: LogEntry;
  /** 关联的源码位置 */
  sourceLocation?: SourceLocation;
  /** 该位置附近的符号定义 */
  nearbySymbols: Symbol[];
  /** 该位置的调用方（如果可解析） */
  callers: Symbol[];
  /** 相关度评分（0-1） */
  relevanceScore: number;
  /** 推荐查看的符号 */
  suggestedSymbols: Symbol[];
}

/** 跨域调试器接口 */
export interface CrossDomainDebugger {
  /**
   * 解析单条日志行，提取文件路径、行号、错误类型、堆栈等信息。
   * 支持以下格式：
   * - Node.js / V8 stack traces
   * - Python traceback
   * - 结构化日志（JSON）
   * - 常见框架日志（Express / NestJS / Fastify / Django / FastAPI）
   * - 通用文件路径+行号格式
   *
   * @param logLine 原始日志行文本
   * @returns 解析后的 LogEntry，若无法识别则返回 null
   */
  parseLogLine(logLine: string): LogEntry | null;

  /**
   * 从一组日志条目中追踪错误源头。
   * 按时间顺序分析日志链，定位最可能的根因位置。
   *
   * @param logEntries 按时间排序的日志条目数组
   * @returns 错误追踪结果
   */
  traceError(logEntries: LogEntry[]): ErrorTrace;

  /**
   * 将日志条目与代码库关联，查找对应的符号定义和调用关系。
   *
   * @param logEntry 已解析的日志条目
   * @param codeIntel CodeIntelligence 实例，用于查询符号
   * @returns 关联结果（包含源码位置、附近符号、调用方等）
   */
  correlateLogWithCode(
    logEntry: LogEntry,
    codeIntel: CodeIntelligence,
  ): Promise<CorrelatedResult>;
}
