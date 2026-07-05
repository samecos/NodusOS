// ============================================================
// CrossDomainDebugger 测试
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import type { CodeIntelligence } from '../code-intel/code-intelligence.js';
import type { Symbol } from '../common/types.js';
import { CrossDomainDebuggerImpl } from './cross-domain-debugger.impl.js';
import type { LogEntry } from './cross-domain-debugger.js';
import { DebugError } from '../common/errors.js';

describe('CrossDomainDebugger', () => {
  let debugger_: CrossDomainDebuggerImpl;

  beforeEach(() => {
    debugger_ = new CrossDomainDebuggerImpl();
  });

  // ============================================================
  // TC-UT-CDD-001 ~ 010: parseLogLine — V8 / Node.js stack traces
  // ============================================================

  it('TC-UT-CDD-001: should parse V8 stack frame with function name', () => {
    const line = '    at processRequest (/app/src/service.ts:42:15)';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('error');
    expect(entry!.stackFrames).toHaveLength(1);
    expect(entry!.stackFrames[0]!).toEqual({
      functionName: 'processRequest',
      filePath: '/app/src/service.ts',
      line: 42,
      column: 15,
    });
  });

  it('TC-UT-CDD-002: should parse V8 stack frame without function name', () => {
    const line = '    at /app/src/utils.js:10:5';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.stackFrames[0]!).toEqual({
      functionName: undefined,
      filePath: '/app/src/utils.js',
      line: 10,
      column: 5,
    });
  });

  it('TC-UT-CDD-003: should parse V8 stack with anonymous function', () => {
    const line = '    at <anonymous> (/app/src/main.ts:8:3)';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.stackFrames[0]!.functionName).toBe('<anonymous>');
  });

  it('TC-UT-CDD-004: should parse error line with type and message', () => {
    const line = 'TypeError: Cannot read property "foo" of undefined';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('error');
    expect(entry!.errorType).toBe('TypeError');
    expect(entry!.message).toBe('Cannot read property "foo" of undefined');
  });

  // ============================================================
  // TC-UT-CDD-005 ~ 008: parseLogLine — Python traceback
  // ============================================================

  it('TC-UT-CDD-005: should parse Python traceback frame', () => {
    const line = '  File "/app/main.py", line 25, in handle_request';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.stackFrames[0]!).toEqual({
      filePath: '/app/main.py',
      line: 25,
      functionName: 'handle_request',
    });
  });

  it('TC-UT-CDD-006: should parse Python traceback without function', () => {
    const line = '  File "/app/lib.py", line 100';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.stackFrames[0]!.filePath).toBe('/app/lib.py');
    expect(entry!.stackFrames[0]!.line).toBe(100);
    expect(entry!.stackFrames[0]!.functionName).toBeUndefined();
  });

  // ============================================================
  // TC-UT-CDD-007 ~ 012: parseLogLine — 结构化日志（JSON）
  // ============================================================

  it('TC-UT-CDD-007: should parse structured JSON log with file/line', () => {
    const line = JSON.stringify({
      level: 'error',
      message: 'Database connection failed',
      file: '/app/src/db.ts',
      line: 30,
      column: 10,
      timestamp: '2024-01-15T10:30:00Z',
    });
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.isStructured).toBe(true);
    expect(entry!.level).toBe('error');
    expect(entry!.message).toBe('Database connection failed');
    expect(entry!.filePath).toBe('/app/src/db.ts');
    expect(entry!.line).toBe(30);
    expect(entry!.column).toBe(10);
    expect(entry!.timestamp).toEqual(new Date('2024-01-15T10:30:00Z'));
  });

  it('TC-UT-CDD-008: should parse structured JSON log with stack field', () => {
    const line = JSON.stringify({
      level: 'error',
      message: 'Something broke',
      stack: 'Error: Something broke\n    at fail (/app/src/index.ts:20:5)\n    at main (/app/src/index.ts:15:3)',
    });
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.stackFrames).toHaveLength(2);
    expect(entry!.stackFrames[0]!.filePath).toBe('/app/src/index.ts');
    expect(entry!.stackFrames[0]!.line).toBe(20);
  });

  it('TC-UT-CDD-009: should parse structured log with alternate field names', () => {
    const line = JSON.stringify({
      severity: 'warn',
      msg: 'Deprecation warning',
      filename: '/app/legacy.js',
      lineno: 5,
    });
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('warn');
    expect(entry!.message).toBe('Deprecation warning');
    expect(entry!.filePath).toBe('/app/legacy.js');
    expect(entry!.line).toBe(5);
  });

  // ============================================================
  // TC-UT-CDD-010 ~ 015: parseLogLine — 通用/框架日志格式
  // ============================================================

  it('TC-UT-CDD-010: should parse generic log with file path and line', () => {
    const line = '2024-01-15 08:20:15 ERROR Something went wrong at /app/src/handler.ts:55';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('error');
    expect(entry!.filePath).toBe('/app/src/handler.ts');
    expect(entry!.line).toBe(55);
  });

  it('TC-UT-CDD-011: should parse NestJS style log', () => {
    const line = '[Nest] 2024-01-15 09:00:00 ERROR [ExceptionHandler] Cannot find module ./foo';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('error');
  });

  it('TC-UT-CDD-012: should parse Django style log', () => {
    const line = 'ERROR (pid:1234): Internal Server Error at /api/users';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('error');
    expect(entry!.message).toBe('Internal Server Error at /api/users');
  });

  it('TC-UT-CDD-013: should parse log with multiple file references', () => {
    const line = 'Error in /app/src/a.ts:10 caused by /app/src/b.ts:20';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.stackFrames).toHaveLength(2);
    expect(entry!.stackFrames[0]!.filePath).toBe('/app/src/a.ts');
    expect(entry!.stackFrames[1]!.filePath).toBe('/app/src/b.ts');
  });

  it('TC-UT-CDD-014: should return null for empty input', () => {
    expect(debugger_.parseLogLine('')).toBeNull();
    expect(debugger_.parseLogLine('   ')).toBeNull();
  });

  it('TC-UT-CDD-015: should parse INFO level log correctly', () => {
    const line = '2024-01-15T10:00:00Z INFO Server started on port 3000';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('info');
    expect(entry!.message).toContain('Server started on port 3000');
  });

  // ============================================================
  // TC-UT-CDD-016 ~ 025: traceError
  // ============================================================

  it('TC-UT-CDD-016: should throw on empty log entries', () => {
    expect(() => debugger_.traceError([])).toThrow(DebugError);
  });

  it('TC-UT-CDD-017: should trace single error log entry', () => {
    const entries: LogEntry[] = [
      {
        raw: 'TypeError: Cannot read property of undefined',
        level: 'error',
        message: 'Cannot read property of undefined',
        errorType: 'TypeError',
        stackFrames: [
          { filePath: '/app/src/a.ts', line: 10, functionName: 'foo' },
          { filePath: '/app/src/b.ts', line: 20, functionName: 'bar' },
        ],
        isStructured: false,
      },
    ];
    const trace = debugger_.traceError(entries);
    expect(trace.errorMessage).toBe('Cannot read property of undefined');
    expect(trace.errorType).toBe('TypeError');
    expect(trace.stackFrames).toHaveLength(2);
    expect(trace.callChain).toHaveLength(2);
    expect(trace.primaryLocation).toEqual({
      file_path: '/app/src/a.ts',
      line_start: 10,
      line_end: 10,
      col_start: 0,
      col_end: 0,
    });
  });

  it('TC-UT-CDD-018: should trace across multiple log entries', () => {
    const entries: LogEntry[] = [
      {
        raw: 'INFO Request started',
        level: 'info',
        message: 'Request started',
        stackFrames: [],
        isStructured: false,
      },
      {
        raw: 'ERROR Database timeout',
        level: 'error',
        message: 'Database timeout',
        errorType: 'Error',
        stackFrames: [
          { filePath: '/app/src/db.ts', line: 30, functionName: 'query' },
        ],
        isStructured: false,
      },
    ];
    const trace = debugger_.traceError(entries);
    expect(trace.errorMessage).toBe('Database timeout');
    expect(trace.errorType).toBe('Error');
    expect(trace.stackFrames).toHaveLength(1);
  });

  it('TC-UT-CDD-019: should deduplicate frames', () => {
    const entries: LogEntry[] = [
      {
        raw: 'error',
        level: 'error',
        message: 'fail',
        stackFrames: [
          { filePath: '/app/src/a.ts', line: 10, functionName: 'foo' },
          { filePath: '/app/src/a.ts', line: 10, functionName: 'foo' },
          { filePath: '/app/src/b.ts', line: 20, functionName: 'bar' },
        ],
        isStructured: false,
      },
    ];
    const trace = debugger_.traceError(entries);
    expect(trace.stackFrames).toHaveLength(2);
  });

  it('TC-UT-CDD-020: should infer root cause from bottom frame', () => {
    const entries: LogEntry[] = [
      {
        raw: 'error',
        level: 'error',
        message: 'fail',
        stackFrames: [
          { filePath: '/app/node_modules/lib/index.js', line: 1, functionName: 'external' },
          { filePath: '/app/src/main.ts', line: 50, functionName: 'main' },
        ],
        isStructured: false,
      },
    ];
    const trace = debugger_.traceError(entries);
    expect(trace.rootCause).toContain('main.ts:50');
    expect(trace.rootCause).toContain('main');
  });

  it('TC-UT-CDD-021: should use non-error entries when no error entries exist', () => {
    const entries: LogEntry[] = [
      {
        raw: 'WARN Possible issue at /app/src/x.ts:5',
        level: 'warn',
        message: 'Possible issue',
        filePath: '/app/src/x.ts',
        line: 5,
        stackFrames: [],
        isStructured: false,
      },
    ];
    const trace = debugger_.traceError(entries);
    expect(trace.errorMessage).toBe('Possible issue');
    expect(trace.stackFrames).toHaveLength(1);
  });

  it('TC-UT-CDD-022: should handle entry with filePath but no stackFrames', () => {
    const entries: LogEntry[] = [
      {
        raw: 'Error at /app/src/handler.ts:100',
        level: 'error',
        message: 'Error',
        filePath: '/app/src/handler.ts',
        line: 100,
        stackFrames: [],
        isStructured: false,
      },
    ];
    const trace = debugger_.traceError(entries);
    expect(trace.stackFrames).toHaveLength(1);
    expect(trace.stackFrames[0]!.filePath).toBe('/app/src/handler.ts');
    expect(trace.stackFrames[0]!.line).toBe(100);
  });

  // ============================================================
  // TC-UT-CDD-023 ~ 030: correlateLogWithCode
  // ============================================================

  it('TC-UT-CDD-023: should throw on null log entry', async () => {
    // @ts-expect-error testing invalid input
    await expect(debugger_.correlateLogWithCode(null, createMockCodeIntel())).rejects.toThrow(DebugError);
  });

  it('TC-UT-CDD-024: should return low relevance when no code location', async () => {
    const entry: LogEntry = {
      raw: 'Some generic log without file info',
      level: 'info',
      message: 'generic',
      stackFrames: [],
      isStructured: false,
    };
    const result = await debugger_.correlateLogWithCode(entry, createMockCodeIntel());
    expect(result.relevanceScore).toBe(0);
    expect(result.nearbySymbols).toHaveLength(0);
    expect(result.suggestedSymbols).toHaveLength(0);
  });

  it('TC-UT-CDD-025: should correlate log with stack frame to symbols', async () => {
    const mockSymbol: Symbol = {
      id: 'sym-001',
      name: 'processRequest',
      kind: 'function',
      language: 'typescript',
      location: {
        file_path: '/app/src/service.ts',
        line_start: 40,
        line_end: 50,
        col_start: 0,
        col_end: 100,
      },
      is_exported: true,
    };
    const codeIntel = createMockCodeIntel({
      symbolsInFile: async () => [mockSymbol],
    });

    const entry: LogEntry = {
      raw: 'at processRequest (/app/src/service.ts:42:15)',
      level: 'error',
      message: 'error',
      stackFrames: [
        { filePath: '/app/src/service.ts', line: 42, functionName: 'processRequest' },
      ],
      isStructured: false,
    };

    const result = await debugger_.correlateLogWithCode(entry, codeIntel);
    expect(result.relevanceScore).toBeGreaterThan(0);
    expect(result.sourceLocation).toEqual({
      file_path: '/app/src/service.ts',
      line_start: 42,
      line_end: 42,
      col_start: 0,
      col_end: 0,
    });
    expect(result.nearbySymbols).toHaveLength(1);
    expect(result.nearbySymbols[0]!.name).toBe('processRequest');
  });

  it('TC-UT-CDD-026: should find callers when function name available', async () => {
    const callerSymbol: Symbol = {
      id: 'sym-caller',
      name: 'handleRoute',
      kind: 'function',
      language: 'typescript',
      location: {
        file_path: '/app/src/router.ts',
        line_start: 10,
        line_end: 20,
        col_start: 0,
        col_end: 100,
      },
      is_exported: true,
    };
    const targetSymbol: Symbol = {
      id: 'sym-target',
      name: 'processRequest',
      kind: 'function',
      language: 'typescript',
      location: {
        file_path: '/app/src/service.ts',
        line_start: 40,
        line_end: 50,
        col_start: 0,
        col_end: 100,
      },
      is_exported: true,
    };

    const codeIntel = createMockCodeIntel({
      symbolsInFile: async () => [targetSymbol],
      findSymbol: async (nameOrId: string) => {
        if (nameOrId === 'sym-caller') return [callerSymbol];
        return [targetSymbol];
      },
      findReferences: async () => [
        {
          id: 'ref-1',
          source_symbol_id: 'sym-caller',
          target_symbol_id: 'sym-target',
          location: {
            file_path: '/app/src/router.ts',
            line_start: 15,
            line_end: 15,
            col_start: 0,
            col_end: 50,
          },
          kind: 'call',
        },
      ],
    });

    const entry: LogEntry = {
      raw: 'error',
      level: 'error',
      message: 'error',
      stackFrames: [
        { filePath: '/app/src/service.ts', line: 42, functionName: 'processRequest' },
      ],
      isStructured: false,
    };

    const result = await debugger_.correlateLogWithCode(entry, codeIntel);
    expect(result.callers).toHaveLength(1);
    expect(result.callers[0]!.name).toBe('handleRoute');
  });

  it('TC-UT-CDD-027: should use filePath+line when no stackFrames', async () => {
    const mockSymbol: Symbol = {
      id: 'sym-002',
      name: 'init',
      kind: 'function',
      language: 'typescript',
      location: {
        file_path: '/app/src/app.ts',
        line_start: 5,
        line_end: 15,
        col_start: 0,
        col_end: 100,
      },
      is_exported: false,
    };
    const codeIntel = createMockCodeIntel({
      symbolsInFile: async () => [mockSymbol],
    });

    const entry: LogEntry = {
      raw: 'Error at /app/src/app.ts:10',
      level: 'error',
      message: 'Error',
      filePath: '/app/src/app.ts',
      line: 10,
      stackFrames: [],
      isStructured: false,
    };

    const result = await debugger_.correlateLogWithCode(entry, codeIntel);
    expect(result.sourceLocation!.file_path).toBe('/app/src/app.ts');
    expect(result.sourceLocation!.line_start).toBe(10);
  });

  it('TC-UT-CDD-028: should deduplicate callers', async () => {
    const callerSymbol: Symbol = {
      id: 'sym-same',
      name: 'callerA',
      kind: 'function',
      language: 'typescript',
      location: {
        file_path: '/app/src/a.ts',
        line_start: 1,
        line_end: 5,
        col_start: 0,
        col_end: 50,
      },
      is_exported: true,
    };

    const codeIntel = createMockCodeIntel({
      symbolsInFile: async () => [],
      findSymbol: async () => [{ ...callerSymbol, id: 'sym-target' }],
      findReferences: async () => [
        {
          id: 'ref-1',
          source_symbol_id: 'sym-same',
          target_symbol_id: 'sym-target',
          location: { file_path: '/app/src/a.ts', line_start: 2, line_end: 2, col_start: 0, col_end: 10 },
          kind: 'call',
        },
        {
          id: 'ref-2',
          source_symbol_id: 'sym-same',
          target_symbol_id: 'sym-target',
          location: { file_path: '/app/src/a.ts', line_start: 3, line_end: 3, col_start: 0, col_end: 10 },
          kind: 'call',
        },
      ],
    });

    const entry: LogEntry = {
      raw: 'error',
      level: 'error',
      message: 'error',
      filePath: '/app/src/a.ts',
      line: 2,
      stackFrames: [],
      isStructured: false,
    };

    const result = await debugger_.correlateLogWithCode(entry, codeIntel);
    // callers 去重后应该只有 1 个
    expect(result.callers.length).toBeLessThanOrEqual(1);
  });

  it('TC-UT-CDD-029: should limit suggested symbols to 5', async () => {
    const symbols: Symbol[] = Array.from({ length: 10 }, (_, i) => ({
      id: `sym-${i}`,
      name: `func${i}`,
      kind: 'function',
      language: 'typescript',
      location: {
        file_path: '/app/src/many.ts',
        line_start: i + 1,
        line_end: i + 2,
        col_start: 0,
        col_end: 50,
      },
      is_exported: true,
    }));

    const codeIntel = createMockCodeIntel({
      symbolsInFile: async () => symbols,
    });

    const entry: LogEntry = {
      raw: 'error',
      level: 'error',
      message: 'error',
      filePath: '/app/src/many.ts',
      line: 5,
      stackFrames: [],
      isStructured: false,
    };

    const result = await debugger_.correlateLogWithCode(entry, codeIntel);
    expect(result.suggestedSymbols.length).toBeLessThanOrEqual(5);
  });

  it('TC-UT-CDD-030: should handle missing file gracefully', async () => {
    const codeIntel = createMockCodeIntel({
      symbolsInFile: async () => { throw new Error('File not indexed'); },
    });

    const entry: LogEntry = {
      raw: 'error at /app/src/missing.ts:1',
      level: 'error',
      message: 'error',
      filePath: '/app/src/missing.ts',
      line: 1,
      stackFrames: [],
      isStructured: false,
    };

    const result = await debugger_.correlateLogWithCode(entry, codeIntel);
    expect(result.nearbySymbols).toHaveLength(0);
    expect(result.sourceLocation).toBeDefined();
  });

  // ============================================================
  // TC-UT-CDD-031 ~ 035: 边缘情况
  // ============================================================

  it('TC-UT-CDD-031: should handle null/undefined input', () => {
    expect(debugger_.parseLogLine('')).toBeNull();
    expect(debugger_.parseLogLine('   ')).toBeNull();
  });

  it('TC-UT-CDD-032: should parse log with Windows path', () => {
    const line = 'Error at C:\\project\\src\\main.ts:25:10';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.filePath).toBe('C:\\project\\src\\main.ts');
    expect(entry!.line).toBe(25);
  });

  it('TC-UT-CDD-033: should parse log with Chinese characters', () => {
    const line = 'ERROR 处理用户请求失败 at /app/src/user.ts:30';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('error');
    expect(entry!.filePath).toBe('/app/src/user.ts');
    expect(entry!.line).toBe(30);
  });

  it('TC-UT-CDD-034: should handle Python exception line', () => {
    const line = 'ValueError: invalid literal for int() with base 10: "abc"';
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.errorType).toBe('ValueError');
    expect(entry!.level).toBe('error');
  });

  it('TC-UT-CDD-035: should parse nested JSON structured log', () => {
    const line = JSON.stringify({
      level: 'error',
      message: 'Nested error',
      meta: { file: '/app/src/nested.ts', line: 99, function: 'deepFn' },
    });
    const entry = debugger_.parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.isStructured).toBe(true);
    expect(entry!.message).toBe('Nested error');
  });
});

// ============================================================
// Mock CodeIntelligence 工厂
// ============================================================

function createMockCodeIntel(
  overrides: Partial<CodeIntelligence> = {},
): CodeIntelligence {
  const defaults: CodeIntelligence = {
    setGitIntel: async () => {},
    indexProject: async () => ({
      filesIndexed: 0, filesFailed: 0, symbolsFound: 0, referencesFound: 0, durationMs: 0, errors: [],
    }),
    indexFile: async () => ({ symbolsAdded: 0, symbolsRemoved: 0, referencesUpdated: 0, durationMs: 0 }),
    indexStatus: () => ({ kind: 'idle' }),
    findSymbol: async () => [],
    findReferences: async () => [],
    findSubclasses: async () => [],
    findImplementations: async () => [],
    findTypeUses: async () => [],
    callGraph: async () => null,
    symbolsInFile: async () => [],
    impactAnalysis: async () => null,
    changeHistory: async () => [],
    query: async () => ({ kind: 'symbol_list', symbols: [] }),
  };
  return { ...defaults, ...overrides };
}
