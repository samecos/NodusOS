// ============================================================
// CrossDomainDebugger 实现 — 日志解析、错误追踪、代码关联
// ============================================================

import type {
  CrossDomainDebugger, LogEntry, LogLevel, StackFrame,
  ErrorTrace, CorrelatedResult,
} from './cross-domain-debugger.js';
import type { CodeIntelligence } from '../code-intel/code-intelligence.js';
import type { Symbol, SourceLocation } from '../common/types.js';
import { DebugError } from '../common/errors.js';

/** 文件路径+行号正则 — 通用匹配（支持 Unix/Windows 路径） */
const FILE_LINE_RE = /((?:[A-Za-z]:)?[\w/.\\~-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|cpp|c|h|hpp|rb|php))[:：](\d+)(?::(\d+))?/gi;

/** V8 / Node.js stack trace: at func (path:line:col) 或 at path:line:col（支持 Windows 路径） */
const V8_STACK_RE = /at\s+(?:(\S+)\s+\()?((?:[A-Za-z]:)?[\w/.\\~-]+\.[\w]+):(\d+):(\d+)\)?/i;

/** Python traceback: File "path", line N, in func */
const PYTHON_TRACE_RE = /File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(\S+))?/i;

/** Python traceback 头部: Traceback (most recent call last): */
const PYTHON_TRACEBACK_START = /Traceback\s+\(most\s+recent\s+call\s+last\)/i;

/** 错误类型行: TypeError: message, ReferenceError: message 等 */
const ERROR_TYPE_RE = /^([A-Z][a-zA-Z0-9]*(?:Error|Exception|Warning|Failure))(?:\s*[:：]\s*|\s+-\s+)(.+)/;

/** 结构化日志 — JSON 对象 */
const STRUCTURED_LOG_RE = /^\s*\{/;

/** 常见日志级别前缀 */
const LEVEL_RE = /\b(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/i;

/** ISO 时间戳 */
const TIMESTAMP_RE = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)/;

/** 框架日志 — Express/NestJS/Fastify 风格 */
const FRAMEWORK_LOG_RE = /\[([\w]+)\]\s+(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\]]*\])?\s*(.*)/;

/** Django 风格日志 */
const DJANGO_LOG_RE = /^(ERROR|WARN(?:ING)?|INFO|DEBUG)\s+\(([^)]+)\):\s*(.+)/i;

/** 常见 timestamp 格式 */
const TIMESTAMP_FORMATS = [
  /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/,
  /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)/,
  /(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/,
  /(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})/,
];

export class CrossDomainDebuggerImpl implements CrossDomainDebugger {
  parseLogLine(logLine: string): LogEntry | null {
    if (!logLine || typeof logLine !== 'string') return null;
    const trimmed = logLine.trim();
    if (trimmed.length === 0) return null;

    // 1. 尝试解析结构化日志（JSON）
    const structured = this.tryParseStructured(trimmed);
    if (structured) return structured;

    // 2. 尝试解析为 stack trace 行（V8 / Node.js）
    const v8Frame = this.tryParseV8Frame(trimmed);
    if (v8Frame) {
      return this.buildEntryFromFrame(trimmed, v8Frame);
    }

    // 3. 尝试解析 Python traceback 行
    const pyFrame = this.tryParsePythonFrame(trimmed);
    if (pyFrame) {
      return this.buildEntryFromFrame(trimmed, pyFrame);
    }

    // 4. 通用日志行解析
    return this.parseGenericLog(trimmed);
  }

  traceError(logEntries: LogEntry[]): ErrorTrace {
    if (!logEntries.length) {
      throw new DebugError(DebugError.EMPTY_LOG, 'traceError 需要至少一条日志');
    }

    // 筛选错误级别日志
    const errorEntries = logEntries.filter(e => e.level === 'error');
    const entriesToTrace = errorEntries.length > 0 ? errorEntries : logEntries;

    // 收集所有 stack frames
    const allFrames: StackFrame[] = [];
    let errorMessage = '';
    let errorType: string | undefined;

    for (const entry of entriesToTrace) {
      if (entry.errorType && !errorType) {
        errorType = entry.errorType;
      }
      if (entry.message && !errorMessage) {
        errorMessage = entry.message;
      }
      if (entry.stackFrames.length > 0) {
        allFrames.push(...entry.stackFrames);
      }
      // 如果日志行本身包含文件位置但没有 stackFrames，也加入
      if (entry.filePath && entry.line && entry.stackFrames.length === 0) {
        allFrames.push({
          filePath: entry.filePath,
          line: entry.line,
          column: entry.column,
          functionName: entry.functionName,
        });
      }
    }

    // 去重并保持顺序
    const dedupedFrames = this.deduplicateFrames(allFrames);

    // 推断根因：最底部的帧通常是用户代码的入口，最顶部的帧是错误触发点
    const callChain = [...dedupedFrames];
    const primaryLocation: SourceLocation | undefined =
      dedupedFrames.length > 0
        ? {
            file_path: dedupedFrames[0]!.filePath,
            line_start: dedupedFrames[0]!.line,
            line_end: dedupedFrames[0]!.line,
            col_start: dedupedFrames[0]!.column ?? 0,
            col_end: dedupedFrames[0]!.column ?? 0,
          }
        : undefined;

    // 推断根因：取最底部的非 node_modules 帧
    const rootFrame = this.findRootCauseFrame(dedupedFrames);
    const rootCause = rootFrame
      ? `${rootFrame.functionName ? rootFrame.functionName + ' @ ' : ''}${rootFrame.filePath}:${rootFrame.line}`
      : undefined;

    return {
      errorMessage,
      errorType,
      rootCause,
      stackFrames: dedupedFrames,
      primaryLocation,
      callChain,
    };
  }

  async correlateLogWithCode(
    logEntry: LogEntry,
    codeIntel: CodeIntelligence,
  ): Promise<CorrelatedResult> {
    if (!logEntry) {
      throw new DebugError(DebugError.INVALID_INPUT, 'logEntry 不能为空');
    }

    // 1. 确定最相关的源码位置
    let targetFile: string | undefined;
    let targetLine: number | undefined;

    // 优先使用 stack frames 的第一个（最顶层）
    if (logEntry.stackFrames.length > 0) {
      targetFile = logEntry.stackFrames[0]!.filePath;
      targetLine = logEntry.stackFrames[0]!.line;
    } else if (logEntry.filePath && logEntry.line) {
      targetFile = logEntry.filePath;
      targetLine = logEntry.line;
    }

    if (!targetFile) {
      return {
        logEntry,
        nearbySymbols: [],
        callers: [],
        relevanceScore: 0,
        suggestedSymbols: [],
      };
    }

    // 2. 构建 SourceLocation
    const sourceLocation: SourceLocation = {
      file_path: targetFile,
      line_start: targetLine ?? 0,
      line_end: targetLine ?? 0,
      col_start: logEntry.column ?? 0,
      col_end: logEntry.column ?? 0,
    };

    // 3. 查询该文件的所有符号
    let nearbySymbols: Symbol[] = [];
    try {
      nearbySymbols = await codeIntel.symbolsInFile(targetFile);
    } catch {
      // 文件可能不在索引中
    }

    // 4. 找到最接近目标行的符号
    const closestSymbols = this.findClosestSymbols(nearbySymbols, targetLine ?? 0);

    // 5. 尝试解析函数名并查找其调用方
    let callers: Symbol[] = [];
    const funcName =
      logEntry.stackFrames[0]?.functionName ?? logEntry.functionName;
    if (funcName) {
      try {
        const syms = await codeIntel.findSymbol(funcName, undefined, targetFile, 3);
        for (const sym of syms) {
          const refs = await codeIntel.findReferences(sym.id);
          // 收集引用方符号
          for (const ref of refs) {
            const callerSyms = await codeIntel.findSymbol(ref.source_symbol_id, undefined, undefined, 1);
            callers.push(...callerSyms);
          }
        }
      } catch {
        // 忽略查询失败
      }
    }

    // 去重
    callers = this.deduplicateSymbols(callers);

    // 6. 计算相关度评分
    const relevanceScore = this.calculateRelevance(logEntry, closestSymbols, callers);

    // 7. 推荐查看的符号：最接近的 + 调用方中最重要的
    const suggestedSymbols = this.pickSuggestedSymbols(closestSymbols, callers);

    return {
      logEntry,
      sourceLocation,
      nearbySymbols,
      callers,
      relevanceScore,
      suggestedSymbols,
    };
  }

  // ---- 解析器实现 ----

  private tryParseStructured(line: string): LogEntry | null {
    if (!STRUCTURED_LOG_RE.test(line)) return null;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const level = this.normalizeLevel(String(obj.level ?? obj.severity ?? 'info'));
      const message = String(obj.message ?? obj.msg ?? obj.text ?? '');
      const filePath = this.extractString(obj, ['file', 'filePath', 'filename', 'path', 'source']);
      const lineNum = this.extractNumber(obj, ['line', 'lineNumber', 'lineno', 'row']);
      const column = this.extractNumber(obj, ['column', 'col', 'columnNumber']);
      const functionName = this.extractString(obj, ['function', 'functionName', 'func', 'method']);

      const stack = this.extractStackFromStructured(obj);

      return {
        raw: line,
        timestamp: this.parseTimestamp(obj.timestamp) ?? undefined,
        level,
        message,
        filePath: filePath ?? undefined,
        line: lineNum ?? undefined,
        column: column ?? undefined,
        functionName: functionName ?? undefined,
        stackFrames: stack,
        isStructured: true,
        structuredFields: obj,
      };
    } catch {
      return null;
    }
  }

  private tryParseV8Frame(line: string): StackFrame | null {
    const match = V8_STACK_RE.exec(line);
    if (!match) return null;
    return {
      functionName: match[1] ?? undefined,
      filePath: match[2]!,
      line: parseInt(match[3]!, 10),
      column: match[4] ? parseInt(match[4], 10) : undefined,
    };
  }

  private tryParsePythonFrame(line: string): StackFrame | null {
    const match = PYTHON_TRACE_RE.exec(line);
    if (!match) return null;
    return {
      filePath: match[1]!,
      line: parseInt(match[2]!, 10),
      functionName: match[3] ?? undefined,
    };
  }

  private buildEntryFromFrame(raw: string, frame: StackFrame): LogEntry {
    // 检查同一行是否还包含错误类型信息
    const errorMatch = ERROR_TYPE_RE.exec(raw);
    return {
      raw,
      level: 'error',
      message: errorMatch?.[2] ?? raw,
      errorType: errorMatch?.[1] ?? undefined,
      filePath: frame.filePath,
      line: frame.line,
      column: frame.column,
      functionName: frame.functionName,
      stackFrames: [frame],
      isStructured: false,
    };
  }

  private parseGenericLog(trimmed: string): LogEntry {
    let remaining = trimmed;
    let timestamp: Date | undefined;
    let level: LogLevel = 'unknown';

    // 提取时间戳
    for (const tsRe of TIMESTAMP_FORMATS) {
      const tsMatch = tsRe.exec(remaining);
      if (tsMatch) {
        const parsed = new Date(tsMatch[1]!);
        if (!isNaN(parsed.getTime())) {
          timestamp = parsed;
          remaining = remaining.slice(0, tsMatch.index) + remaining.slice(tsMatch.index! + tsMatch[0].length);
        }
        break;
      }
    }

    // 提取日志级别
    const levelMatch = LEVEL_RE.exec(remaining);
    if (levelMatch) {
      level = this.normalizeLevel(levelMatch[1]!);
      remaining = remaining.slice(0, levelMatch.index) + remaining.slice(levelMatch.index! + levelMatch[0].length);
    }

    // 尝试 Django 风格
    const djangoMatch = DJANGO_LOG_RE.exec(trimmed);
    if (djangoMatch) {
      level = this.normalizeLevel(djangoMatch[1]!);
      remaining = djangoMatch[3]!;
    }

    // 尝试框架风格 [Nest] ...
    const fwMatch = FRAMEWORK_LOG_RE.exec(trimmed);
    if (fwMatch && !djangoMatch) {
      remaining = fwMatch[3]!;
    }

    remaining = remaining.trim();

    // 提取错误类型
    const errorMatch = ERROR_TYPE_RE.exec(remaining);
    const errorType = errorMatch?.[1];
    const message = errorMatch?.[2] ?? remaining;

    // 提取文件路径和行号
    const fileMatches = this.extractAllFileMatches(remaining);

    // 构建 stack frames（从通用匹配中）
    const stackFrames: StackFrame[] = fileMatches.map(m => ({
      filePath: m.filePath,
      line: m.line,
      column: m.column,
    }));

    // 主文件位置（第一个匹配）
    const primaryFile = fileMatches[0];

    return {
      raw: trimmed,
      timestamp,
      level: errorType ? 'error' : level,
      message,
      errorType: errorType ?? undefined,
      filePath: primaryFile?.filePath,
      line: primaryFile?.line,
      column: primaryFile?.column,
      stackFrames,
      isStructured: false,
    };
  }

  private extractAllFileMatches(text: string): Array<{ filePath: string; line: number; column?: number }> {
    const matches: Array<{ filePath: string; line: number; column?: number }> = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    // 重置 lastIndex
    FILE_LINE_RE.lastIndex = 0;
    while ((m = FILE_LINE_RE.exec(text)) !== null) {
      const key = `${m[1]}:${m[2]}:${m[3] ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({
          filePath: m[1]!,
          line: parseInt(m[2]!, 10),
          column: m[3] ? parseInt(m[3], 10) : undefined,
        });
      }
    }
    return matches;
  }

  private normalizeLevel(level: string): LogLevel {
    const upper = level.toUpperCase();
    if (upper.startsWith('ERR')) return 'error';
    if (upper.startsWith('WARN')) return 'warn';
    if (upper.startsWith('INFO')) return 'info';
    if (upper.startsWith('DEBUG')) return 'debug';
    if (upper.startsWith('TRACE')) return 'trace';
    return 'unknown';
  }

  private parseTimestamp(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'number') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  private extractString(obj: Record<string, unknown>, keys: string[]): string | null {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
  }

  private extractNumber(obj: Record<string, unknown>, keys: string[]): number | null {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = parseInt(v, 10);
        if (!isNaN(n)) return n;
      }
    }
    return null;
  }

  private extractStackFromStructured(obj: Record<string, unknown>): StackFrame[] {
    const stack = obj.stack ?? obj.stacktrace ?? obj.stack_trace ?? obj.traceback;
    if (typeof stack !== 'string') return [];
    const frames: StackFrame[] = [];
    const lines = stack.split('\n');
    for (const line of lines) {
      const v8 = this.tryParseV8Frame(line);
      if (v8) { frames.push(v8); continue; }
      const py = this.tryParsePythonFrame(line);
      if (py) { frames.push(py); continue; }
    }
    return frames;
  }

  // ---- traceError 辅助 ----

  private deduplicateFrames(frames: StackFrame[]): StackFrame[] {
    const seen = new Set<string>();
    const result: StackFrame[] = [];
    for (const f of frames) {
      const key = `${f.filePath}:${f.line}:${f.functionName ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(f);
      }
    }
    return result;
  }

  private findRootCauseFrame(frames: StackFrame[]): StackFrame | undefined {
    // 从底部往上找，第一个非 node_modules / 非内部框架的帧
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i]!;
      if (!f.filePath.includes('node_modules') &&
          !f.filePath.includes('/internal/') &&
          !f.filePath.includes('<anonymous>') &&
          !f.filePath.includes('<native>')) {
        return f;
      }
    }
    return frames[frames.length - 1];
  }

  // ---- correlateLogWithCode 辅助 ----

  private findClosestSymbols(symbols: Symbol[], targetLine: number): Symbol[] {
    const scored = symbols
      .map(s => {
        const dist = Math.abs(s.location.line_start - targetLine);
        return { symbol: s, dist };
      })
      .sort((a, b) => a.dist - b.dist);
    return scored.slice(0, 5).map(s => s.symbol);
  }

  private deduplicateSymbols(symbols: Symbol[]): Symbol[] {
    const seen = new Set<string>();
    return symbols.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }

  private calculateRelevance(
    logEntry: LogEntry,
    closestSymbols: Symbol[],
    callers: Symbol[],
  ): number {
    let score = 0;
    if (logEntry.stackFrames.length > 0) score += 0.3;
    if (logEntry.filePath && logEntry.line) score += 0.2;
    if (closestSymbols.length > 0) score += 0.25;
    if (callers.length > 0) score += 0.25;
    return Math.min(1, score);
  }

  private pickSuggestedSymbols(closest: Symbol[], callers: Symbol[]): Symbol[] {
    const suggested = [...closest.slice(0, 3)];
    const seen = new Set(suggested.map(s => s.id));
    for (const c of callers) {
      if (seen.size >= 5) break;
      if (!seen.has(c.id)) {
        seen.add(c.id);
        suggested.push(c);
      }
    }
    return suggested;
  }
}
