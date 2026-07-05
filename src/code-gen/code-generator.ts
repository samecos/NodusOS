// ============================================================
// CodeGenerator — AI 代码生成与重构接口
// R3.1 基于索引生成 diff 卡片
// ============================================================

import type { CodeChange, SymbolId, Symbol } from '../common/types.js';

export type RefactoringType = 'rename' | 'extract_function' | 'extract_variable' | 'move';

export interface RefactoringOptions {
  type: RefactoringType;
  symbolId: SymbolId;
  newName?: string;
  sourceCode?: string;
  startLine?: number;
  endLine?: number;
  targetFile?: string;
}

export interface DiffOptions {
  filePath: string;
  description: string;
  sourceCode?: string;
}

export interface ImprovementSuggestion {
  type: 'dead_code' | 'complexity' | 'coupling' | 'naming' | 'typing';
  severity: 'low' | 'medium' | 'high';
  message: string;
  targetSymbol?: Symbol;
  proposedChange?: CodeChange;
}

export interface CodeGenerator {
  /** 基于索引生成重构变更卡片（重命名、提取函数/变量等） */
  generateRefactoring(options: RefactoringOptions): Promise<CodeChange[]>;

  /** 基于自然语言描述生成代码变更 diff */
  generateDiff(options: DiffOptions): Promise<CodeChange[]>;

  /** 基于代码分析结果给出改进建议 */
  suggestImprovements(filePath?: string): Promise<ImprovementSuggestion[]>;
}
