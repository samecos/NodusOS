// ============================================================
// CodeGenerator 单元测试
// TC-UT-CG-001 ~ TC-UT-CG-015
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { CodeGeneratorImpl } from './code-generator.impl.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { CodeIntelligence } from '../code-intel/code-intelligence.js';
import type { CodeAnalytics } from '../code-intel/code-analytics.js';
import type { Symbol, Reference } from '../common/types.js';
import { CodeIntelError } from '../common/errors.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockImplementation((path: string) => {
    if (typeof path === 'string' && path.includes('b.ts')) return 'oldName()';
    return '';
  }),
}));

// ---------- mock factory ----------

function createMockStore(overrides?: Partial<KnowledgeStore>): KnowledgeStore {
  return {
    symbolsFindById: vi.fn(),
    symbolsFindByFile: vi.fn(),
    symbolsFindByName: vi.fn(),
    symbolsFindByModule: vi.fn(),
    symbolsFindAll: vi.fn(),
    symbolsSearch: vi.fn(),
    symbolsUpsert: vi.fn(),
    symbolsRemove: vi.fn(),
    refsFindByTarget: vi.fn(),
    refsFindBySource: vi.fn(),
    refsFindByFile: vi.fn(),
    refsFindAll: vi.fn(),
    refsUpsert: vi.fn(),
    refsRemoveForFile: vi.fn(),
    callgraphStore: vi.fn(),
    callgraphGet: vi.fn(),
    callgraphRebuildForFile: vi.fn(),
    fileStateGet: vi.fn(),
    fileStateUpsert: vi.fn(),
    fileStateRemove: vi.fn(),
    projectGet: vi.fn(),
    projectGetFull: vi.fn(),
    projectUpsert: vi.fn(),
    projectUpsertFull: vi.fn(),
    projectList: vi.fn(),
    runtimesGet: vi.fn(),
    runtimesUpsert: vi.fn(),
    dependenciesGet: vi.fn(),
    dependenciesUpsert: vi.fn(),
    prefGet: vi.fn(),
    prefSet: vi.fn(),
    prefDelete: vi.fn(),
    historyRecord: vi.fn(),
    historyRecent: vi.fn(),
    historySearch: vi.fn(),
    historyCleanup: vi.fn(),
    sessionStateGet: vi.fn(),
    sessionStateUpsert: vi.fn(),
    sessionStateRemove: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as unknown as KnowledgeStore;
}

function createMockCodeIntel(): CodeIntelligence {
  return {
    setGitIntel: vi.fn(),
    indexProject: vi.fn(),
    indexFile: vi.fn(),
    indexStatus: vi.fn(),
    findSymbol: vi.fn(),
    findReferences: vi.fn(),
    findSubclasses: vi.fn(),
    findImplementations: vi.fn(),
    findTypeUses: vi.fn(),
    callGraph: vi.fn(),
    symbolsInFile: vi.fn(),
    impactAnalysis: vi.fn(),
    changeHistory: vi.fn(),
    query: vi.fn(),
  } as unknown as CodeIntelligence;
}

function createMockAnalytics(): CodeAnalytics {
  return {
    listSymbols: vi.fn(),
    mostCalledFunctions: vi.fn(),
    mostImpactfulSymbols: vi.fn(),
    unusedExports: vi.fn(),
    mostCoupledModules: vi.fn(),
    longestCallChains: vi.fn(),
    findEntryPoints: vi.fn(),
    listTodoComments: vi.fn(),
    complexityScores: vi.fn(),
    mostChangedFiles: vi.fn(),
    typeRelationships: vi.fn(),
  } as unknown as CodeAnalytics;
}

// ---------- tests ----------

describe('CodeGenerator', () => {
  describe('generateRefactoring', () => {
    // TC-UT-CG-001: rename 符号生成单文件 diff
    it('TC-UT-CG-001: should generate rename refactoring diff for single file', async () => {
      const sym: Symbol = {
        id: 'sym-1',
        name: 'oldName',
        kind: 'function',
        language: 'typescript',
        location: { file_path: 'src/test.ts', line_start: 1, line_end: 3, col_start: 0, col_end: 20 },
        is_exported: true,
      };

      const store = createMockStore({
        symbolsFindById: vi.fn().mockReturnValue(sym),
        refsFindByTarget: vi.fn().mockReturnValue([]),
      });

      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      const changes = await generator.generateRefactoring({
        type: 'rename',
        symbolId: 'sym-1',
        newName: 'newName',
        sourceCode: 'function oldName() {}\nconst x = oldName;\n',
      });

      expect(changes.length).toBe(1);
      expect(changes[0]!.file_path).toBe('src/test.ts');
      expect(changes[0]!.diff_text).toContain('diff --git');
      expect(changes[0]!.diff_text).toContain('--- a/src/test.ts');
      expect(changes[0]!.diff_text).toContain('+++ b/src/test.ts');
      expect(changes[0]!.diff_text).toContain('@@');
      expect(changes[0]!.diff_text).toContain('-function oldName() {}');
      expect(changes[0]!.diff_text).toContain('+function newName() {}');
      expect(changes[0]!.diff_text).toContain('-const x = oldName;');
      expect(changes[0]!.diff_text).toContain('+const x = newName;');
    });

    // TC-UT-CG-002: rename 跨文件引用
    it('TC-UT-CG-002: should generate rename diff across referenced files', async () => {
      const sym: Symbol = {
        id: 'sym-1',
        name: 'oldName',
        kind: 'function',
        language: 'typescript',
        location: { file_path: 'src/a.ts', line_start: 1, line_end: 3, col_start: 0, col_end: 20 },
        is_exported: true,
      };

      const ref: Reference = {
        id: 'ref-1',
        source_symbol_id: 'sym-2',
        target_symbol_id: 'sym-1',
        location: { file_path: 'src/b.ts', line_start: 2, line_end: 2, col_start: 0, col_end: 10 },
        kind: 'call',
      };

      const store = createMockStore({
        symbolsFindById: vi.fn().mockReturnValue(sym),
        refsFindByTarget: vi.fn().mockReturnValue([ref]),
      });

      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      const changes = await generator.generateRefactoring({
        type: 'rename',
        symbolId: 'sym-1',
        newName: 'newName',
        sourceCode: 'export function oldName() {}',
      });

      expect(changes.length).toBe(2);
      const paths = changes.map(c => c.file_path);
      expect(paths).toContain('src/a.ts');
      expect(paths).toContain('src/b.ts');
    });

    // TC-UT-CG-003: extractFunction 提取代码块
    it('TC-UT-CG-003: should extract selected lines into a new function', async () => {
      const store = createMockStore();
      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      const source = `function processOrder() {
  const amount = 100;
  const tax = amount * 0.1;
  const total = amount + tax;
  return total;
}`;

      const changes = await generator.generateRefactoring({
        type: 'extract_function',
        symbolId: 'sym-1',
        newName: 'calculateTotal',
        sourceCode: source,
        startLine: 2,
        endLine: 4,
        targetFile: 'src/order.ts',
      });

      expect(changes.length).toBe(1);
      expect(changes[0]!.file_path).toBe('src/order.ts');
      expect(changes[0]!.new_code).toContain('function calculateTotal()');
      expect(changes[0]!.new_code).toContain('calculateTotal();');
      expect(changes[0]!.diff_text).toContain('diff --git');
      expect(changes[0]!.diff_text).toContain('@@');
    });

    // TC-UT-CG-009: rename 不存在的 symbol 应抛出错误
    it('TC-UT-CG-009: should throw CodeIntelError when symbol not found', async () => {
      const store = createMockStore({
        symbolsFindById: vi.fn().mockReturnValue(undefined),
      });

      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      await expect(generator.generateRefactoring({
        type: 'rename',
        symbolId: 'sym-xxx',
        newName: 'newName',
      })).rejects.toThrow(CodeIntelError);
    });

    // TC-UT-CG-010: extractFunction 无效行范围
    it('TC-UT-CG-010: should return empty for invalid line range', async () => {
      const store = createMockStore();
      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      const changes = await generator.generateRefactoring({
        type: 'extract_function',
        symbolId: 'sym-1',
        sourceCode: 'function a() {}',
        startLine: 5,
        endLine: 10,
        targetFile: 'src/test.ts',
      });

      expect(changes.length).toBe(0);
    });

    // TC-UT-CG-013: extractFunction 缺少 sourceCode 返回空
    it('TC-UT-CG-013: should return empty when sourceCode is missing for extract', async () => {
      const store = createMockStore();
      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      const changes = await generator.generateRefactoring({
        type: 'extract_function',
        symbolId: 'sym-1',
        startLine: 1,
        endLine: 2,
        targetFile: 'src/test.ts',
      });

      expect(changes.length).toBe(0);
    });
  });

  describe('generateDiff', () => {
    // TC-UT-CG-004: 基于描述重命名
    it('TC-UT-CG-004: should generate diff for rename description', async () => {
      const store = createMockStore();
      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      const changes = await generator.generateDiff({
        filePath: 'src/test.ts',
        description: 'rename oldFunc to newFunc',
        sourceCode: 'function oldFunc() {}\noldFunc();\n',
      });

      expect(changes.length).toBe(1);
      expect(changes[0]!.diff_text).toContain('+function newFunc() {}');
      expect(changes[0]!.diff_text).toContain('+newFunc();');
    });

    // TC-UT-CG-005: 基于描述转为 async
    it('TC-UT-CG-005: should generate diff for making functions async', async () => {
      const store = createMockStore();
      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      const changes = await generator.generateDiff({
        filePath: 'src/test.ts',
        description: 'make all functions async',
        sourceCode: 'function a() {}\nexport function b() {}\n',
      });

      expect(changes.length).toBe(1);
      expect(changes[0]!.new_code).toContain('async function a()');
      expect(changes[0]!.new_code).toContain('export async function b()');
    });

    // TC-UT-CG-012: 无匹配描述返回空
    it('TC-UT-CG-012: should return empty for unrecognized description', async () => {
      const store = createMockStore();
      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      const changes = await generator.generateDiff({
        filePath: 'src/test.ts',
        description: 'do something impossible',
        sourceCode: 'function a() {}\n',
      });

      expect(changes.length).toBe(0);
    });
  });

  describe('suggestImprovements', () => {
    // TC-UT-CG-006: 死代码建议
    it('TC-UT-CG-006: should suggest dead code improvements', async () => {
      const deadSym: Symbol = {
        id: 'sym-dead',
        name: 'unusedHelper',
        kind: 'function',
        language: 'typescript',
        location: { file_path: 'src/utils.ts', line_start: 1, line_end: 5, col_start: 0, col_end: 30 },
        is_exported: true,
      };

      const analytics = createMockAnalytics();
      analytics.unusedExports = vi.fn().mockResolvedValue([deadSym]);

      const store = createMockStore();
      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), analytics);

      const suggestions = await generator.suggestImprovements();

      expect(suggestions.length).toBeGreaterThan(0);
      const dead = suggestions.find(s => s.type === 'dead_code');
      expect(dead).toBeDefined();
      expect(dead!.message).toContain('unusedHelper');
      expect(dead!.severity).toBe('medium');
    });

    // TC-UT-CG-007: 复杂度建议
    it('TC-UT-CG-007: should suggest complexity improvements', async () => {
      const complexSym: Symbol = {
        id: 'sym-complex',
        name: 'heavyLogic',
        kind: 'function',
        language: 'typescript',
        location: { file_path: 'src/logic.ts', line_start: 10, line_end: 50, col_start: 0, col_end: 10 },
        is_exported: false,
      };

      const analytics = createMockAnalytics();
      analytics.complexityScores = vi.fn().mockResolvedValue([{
        symbol: complexSym,
        score: 25,
        factors: ['nested loops', 'deep branching'],
      }]);

      const store = createMockStore();
      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), analytics);

      const suggestions = await generator.suggestImprovements();

      const comp = suggestions.find(s => s.type === 'complexity');
      expect(comp).toBeDefined();
      expect(comp!.severity).toBe('high');
      expect(comp!.message).toContain('25');
      expect(comp!.message).toContain('nested loops');
    });

    // TC-UT-CG-011: 文件过滤
    it('TC-UT-CG-011: should filter suggestions by filePath', async () => {
      const symA: Symbol = {
        id: 'sym-a',
        name: 'funcA',
        kind: 'function',
        language: 'typescript',
        location: { file_path: 'src/a.ts', line_start: 1, line_end: 2, col_start: 0, col_end: 10 },
        is_exported: true,
      };

      const symB: Symbol = {
        id: 'sym-b',
        name: 'funcB',
        kind: 'function',
        language: 'typescript',
        location: { file_path: 'src/b.ts', line_start: 1, line_end: 2, col_start: 0, col_end: 10 },
        is_exported: true,
      };

      const analytics = createMockAnalytics();
      analytics.unusedExports = vi.fn().mockResolvedValue([symA, symB]);

      const store = createMockStore();
      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), analytics);

      const suggestions = await generator.suggestImprovements('src/a.ts');

      expect(suggestions.length).toBe(1);
      expect(suggestions[0]!.targetSymbol!.name).toBe('funcA');
    });
  });

  describe('diff format', () => {
    // TC-UT-CG-008: diff 文本包含必要元素
    it('TC-UT-CG-008: should produce git-diff compatible output', async () => {
      const sym: Symbol = {
        id: 'sym-fmt',
        name: 'foo',
        kind: 'function',
        language: 'typescript',
        location: { file_path: 'src/fmt.ts', line_start: 1, line_end: 1, col_start: 0, col_end: 10 },
        is_exported: true,
      };

      const store = createMockStore({
        symbolsFindById: vi.fn().mockReturnValue(sym),
        refsFindByTarget: vi.fn().mockReturnValue([]),
      });

      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      const changes = await generator.generateRefactoring({
        type: 'rename',
        symbolId: 'sym-fmt',
        newName: 'bar',
        sourceCode: 'function foo() {}\n',
      });

      const diff = changes[0]!.diff_text;
      expect(diff).toMatch(/^diff --git a\/src\/fmt\.ts b\/src\/fmt\.ts/m);
      expect(diff).toContain('--- a/src/fmt.ts');
      expect(diff).toContain('+++ b/src/fmt.ts');
      expect(diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
      expect(diff).toContain('-function foo() {}');
      expect(diff).toContain('+function bar() {}');
    });

    // TC-UT-CG-014: 行号正确性
    it('TC-UT-CG-014: should contain correct line numbers in diff', async () => {
      const store = createMockStore();
      const generator = new CodeGeneratorImpl(store, createMockCodeIntel(), createMockAnalytics());

      const changes = await generator.generateDiff({
        filePath: 'src/test.ts',
        description: 'rename helper to helperV2',
        sourceCode: 'function helper() {}\nconst a = 1;\nconst b = helper();\n',
      });

      const diff = changes[0]!.diff_text;
      // sourceCode 末尾换行 split 后共 4 行（含末尾空行）
      expect(diff).toMatch(/@@ -1,4 \+1,4 @@/);
    });
  });
});
