// ============================================================
// CodeGenerator 实现 — 基于索引的结构化代码变换
// 生成 git diff 兼容的统一差异格式
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { CodeIntelligence } from '../code-intel/code-intelligence.js';
import type { CodeAnalytics } from '../code-intel/code-analytics.js';
import type { CodeChange, SymbolId, Symbol } from '../common/types.js';
import type {
  CodeGenerator, RefactoringOptions, DiffOptions, ImprovementSuggestion,
} from './code-generator.js';
import { CodeIntelError } from '../common/errors.js';

interface DiffLineEntry {
  type: 'added' | 'removed' | 'context';
  text: string;
}

/** 行级统一差异构建器，输出与 git diff 兼容 */
class DiffBuilder {
  private oldLines: string[];
  private newLines: string[];

  constructor(oldSource: string, newSource: string) {
    this.oldLines = oldSource.split('\n');
    this.newLines = newSource.split('\n');
  }

  build(filePath: string): string {
    const changes = this.computeDiff(this.oldLines, this.newLines);
    const hunks = this.groupHunks(changes);

    let result = `diff --git a/${filePath} b/${filePath}\n`;
    result += `--- a/${filePath}\n`;
    result += `+++ b/${filePath}\n`;

    for (const hunk of hunks) {
      const oldStartStr = hunk.oldCount === 0 ? '0' : String(hunk.oldStart + 1);
      const newStartStr = hunk.newCount === 0 ? '0' : String(hunk.newStart + 1);
      result += `@@ -${oldStartStr},${hunk.oldCount} +${newStartStr},${hunk.newCount} @@\n`;
      for (const line of hunk.lines) {
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        result += `${prefix}${line.text}\n`;
      }
    }

    return result;
  }

  private computeDiff(
    oldLines: string[],
    newLines: string[],
  ): { type: 'same' | 'removed' | 'added'; text: string; oldIndex?: number; newIndex?: number }[] {
    const m = oldLines.length;
    const n = newLines.length;

    // LCS 动态规划表
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const changes: { type: 'same' | 'removed' | 'added'; text: string; oldIndex?: number; newIndex?: number }[] = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        changes.unshift({ type: 'same', text: oldLines[i - 1]!, oldIndex: i - 1, newIndex: j - 1 });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        changes.unshift({ type: 'added', text: newLines[j - 1]!, newIndex: j - 1 });
        j--;
      } else if (i > 0) {
        changes.unshift({ type: 'removed', text: oldLines[i - 1]!, oldIndex: i - 1 });
        i--;
      }
    }
    return changes;
  }

  private groupHunks(
    changes: { type: 'same' | 'removed' | 'added'; text: string; oldIndex?: number; newIndex?: number }[],
  ): { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: DiffLineEntry[] }[] {
    const hunks: { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: DiffLineEntry[] }[] = [];
    const context = 3;

    const inHunk = new Set<number>();
    for (let i = 0; i < changes.length; i++) {
      if (changes[i]!.type !== 'same') {
        for (let j = Math.max(0, i - context); j <= Math.min(changes.length - 1, i + context); j++) {
          inHunk.add(j);
        }
      }
    }

    let i = 0;
    while (i < changes.length) {
      if (!inHunk.has(i)) { i++; continue; }

      let start = i;
      while (i < changes.length && inHunk.has(i)) i++;
      let end = i;

      let oldStart = 0;
      let newStart = 0;
      let oldCount = 0;
      let newCount = 0;
      let foundFirst = false;
      const lines: DiffLineEntry[] = [];

      for (let j = start; j < end; j++) {
        const ch = changes[j]!;
        if (ch.type === 'same') {
          if (!foundFirst) {
            oldStart = ch.oldIndex!;
            newStart = ch.newIndex!;
            foundFirst = true;
          }
          lines.push({ type: 'context', text: ch.text });
          oldCount++;
          newCount++;
        } else if (ch.type === 'removed') {
          if (!foundFirst) {
            oldStart = ch.oldIndex!;
            let nextNew = -1;
            for (let k = j - 1; k >= start; k--) {
              if (changes[k]!.newIndex !== undefined) {
                nextNew = changes[k]!.newIndex!;
                break;
              }
            }
            if (nextNew === -1) {
              for (let k = j + 1; k < end; k++) {
                if (changes[k]!.newIndex !== undefined) {
                  nextNew = changes[k]!.newIndex!;
                  break;
                }
              }
            }
            newStart = nextNew !== -1 ? nextNew : 0;
            foundFirst = true;
          }
          lines.push({ type: 'removed', text: ch.text });
          oldCount++;
        } else if (ch.type === 'added') {
          if (!foundFirst) {
            newStart = ch.newIndex!;
            let nextOld = -1;
            for (let k = j - 1; k >= start; k--) {
              if (changes[k]!.oldIndex !== undefined) {
                nextOld = changes[k]!.oldIndex!;
                break;
              }
            }
            if (nextOld === -1) {
              for (let k = j + 1; k < end; k++) {
                if (changes[k]!.oldIndex !== undefined) {
                  nextOld = changes[k]!.oldIndex!;
                  break;
                }
              }
            }
            oldStart = nextOld !== -1 ? nextOld : 0;
            foundFirst = true;
          }
          lines.push({ type: 'added', text: ch.text });
          newCount++;
        }
      }

      if (lines.length > 0) {
        hunks.push({
          oldStart: Math.max(0, oldStart),
          oldCount,
          newStart: Math.max(0, newStart),
          newCount,
          lines,
        });
      }
    }

    return hunks;
  }
}

export class CodeGeneratorImpl implements CodeGenerator {
  constructor(
    private store: KnowledgeStore,
    private codeIntel: CodeIntelligence,
    private analytics: CodeAnalytics,
  ) {}

  async generateRefactoring(options: RefactoringOptions): Promise<CodeChange[]> {
    switch (options.type) {
      case 'rename':
        return this.renameSymbol(options.symbolId, options.newName ?? '', options.sourceCode);
      case 'extract_function':
        return this.extractFunction(options);
      case 'extract_variable':
        return this.extractVariable(options);
      case 'move':
        return this.moveSymbol(options);
      default:
        return [];
    }
  }

  async generateDiff(options: DiffOptions): Promise<CodeChange[]> {
    const source = options.sourceCode ?? this.readFile(options.filePath);
    const oldLines = source.split('\n');
    let newLines = [...oldLines];

    const desc = options.description.toLowerCase();

    if (options.description.toLowerCase().includes('rename') && options.description.toLowerCase().includes('to')) {
      const match = options.description.match(/rename\s+(\w+)\s+to\s+(\w+)/i);
      if (match) {
        const oldName = match[1]!;
        const newName = match[2]!;
        newLines = newLines.map(line => line.replace(new RegExp(`\\b${oldName}\\b`, 'g'), newName));
      }
    } else if ((desc.includes('async') || (desc.includes('make') && desc.includes('function'))) && desc.includes('async')) {
      // 将所有非 async 的 function 声明转为 async
      newLines = newLines.map(line => {
        if (/^\s*(export\s+)?function\s+\w+/.test(line) && !line.includes('async')) {
          return line.replace(/(^\s*)(export\s+)?(function\s+)/, '$1$2async $3');
        }
        return line;
      });
    } else if (desc.includes('type') && (desc.includes('annotation') || desc.includes('add'))) {
      // 为无类型的函数参数添加 any 类型（简化规则）
      newLines = newLines.map(line => {
        if (/function\s+\w+\s*\([^)]*\)/.test(line) && !line.includes(':')) {
          return line.replace(/(\w+)(?=\s*[,)])/g, '$1: any');
        }
        return line;
      });
    }

    const newSource = newLines.join('\n');
    if (newSource === source) {
      return [];
    }

    const diff = new DiffBuilder(source, newSource).build(options.filePath);
    return [{
      file_path: options.filePath,
      change_type: 'modified',
      old_code: source,
      new_code: newSource,
      diff_text: diff,
    }];
  }

  async suggestImprovements(filePath?: string): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];

    const dead = (await this.analytics.unusedExports(20)) ?? [];
    for (const sym of dead) {
      if (filePath && sym.location.file_path !== filePath) continue;
      suggestions.push({
        type: 'dead_code',
        severity: 'medium',
        message: `导出符号 "${sym.name}" 未被项目内引用，可考虑删除或确认是否为外部 API。`,
        targetSymbol: sym,
      });
    }

    const complexity = (await this.analytics.complexityScores(20)) ?? [];
    for (const score of complexity) {
      if (filePath && score.symbol.location.file_path !== filePath) continue;
      const sev = score.score > 20 ? 'high' : 'medium';
      suggestions.push({
        type: 'complexity',
        severity: sev,
        message: `符号 "${score.symbol.name}" 复杂度较高（${score.score}），建议拆分：${score.factors.join('、')}。`,
        targetSymbol: score.symbol,
      });
    }

    const coupled = (await this.analytics.mostCoupledModules(10)) ?? [];
    for (const cp of coupled) {
      if (filePath && !cp.moduleA.includes(filePath) && !cp.moduleB.includes(filePath)) continue;
      suggestions.push({
        type: 'coupling',
        severity: cp.referenceCount > 50 ? 'high' : 'medium',
        message: `模块 "${cp.moduleA}" 与 "${cp.moduleB}" 耦合度较高（引用 ${cp.referenceCount} 次），建议审视接口边界。`,
      });
    }

    return suggestions;
  }

  // ========== 内部重构实现 ==========

  private renameSymbol(symbolId: SymbolId, newName: string, singleFileSource?: string): CodeChange[] {
    const symbol = this.store.symbolsFindById(symbolId);
    if (!symbol) {
      throw new CodeIntelError(CodeIntelError.NOT_INDEXED, `Symbol not found: ${symbolId}`);
    }

    const refs = this.store.refsFindByTarget(symbolId);
    const files = new Set([symbol.location.file_path, ...refs.map(r => r.location.file_path)]);

    const changes: CodeChange[] = [];
    for (const file of files) {
      const source = singleFileSource && file === symbol.location.file_path ? singleFileSource : this.readFile(file);
      const oldLines = source.split('\n');
      const newLines = oldLines.map(line => line.replace(new RegExp(`\\b${symbol.name}\\b`, 'g'), newName));

      const newSource = newLines.join('\n');
      if (newSource === source) continue;

      const diff = new DiffBuilder(source, newSource).build(file);
      changes.push({
        file_path: file,
        change_type: 'modified',
        old_code: source,
        new_code: newSource,
        diff_text: diff,
      });
    }

    return changes;
  }

  private extractFunction(options: RefactoringOptions): CodeChange[] {
    if (!options.sourceCode || !options.startLine || !options.endLine) {
      return [];
    }

    const filePath = options.targetFile ?? '';
    const source = options.sourceCode;
    const lines = source.split('\n');
    const start = (options.startLine ?? 1) - 1;
    const end = (options.endLine ?? lines.length) - 1;

    if (start < 0 || end >= lines.length || start > end) {
      return [];
    }

    const extractedLines = lines.slice(start, end + 1);
    const funcName = options.newName ?? 'extractedHelper';
    const indent = this.detectIndent(extractedLines[0] ?? '');

    // 去除原有缩进后作为新函数体
    const newFuncBody = extractedLines.map(l => {
      if (l.startsWith(indent)) return l.slice(indent.length);
      return l;
    }).join('\n');
    const newFunc = `${indent}function ${funcName}() {\n${newFuncBody}\n${indent}}`;

    const newLines = [...lines];
    // 替换原位置为函数调用
    newLines.splice(start, end - start + 1, `${indent}${funcName}();`);

    // 将新函数插入到文件末尾
    const insertPos = this.findInsertPosition(newLines);
    newLines.splice(insertPos, 0, newFunc);

    const newSource = newLines.join('\n');
    const diff = new DiffBuilder(source, newSource).build(filePath);

    return [{
      file_path: filePath,
      change_type: 'modified',
      old_code: source,
      new_code: newSource,
      diff_text: diff,
    }];
  }

  private extractVariable(options: RefactoringOptions): CodeChange[] {
    // 简化实现：暂不支持提取变量，返回空数组
    return [];
  }

  private moveSymbol(options: RefactoringOptions): CodeChange[] {
    // 简化实现：暂不支持移动符号，返回空数组
    return [];
  }

  // ========== 工具方法 ==========

  private readFile(filePath: string): string {
    if (!existsSync(filePath)) return '';
    return readFileSync(filePath, 'utf-8');
  }

  private detectIndent(line: string): string {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : '';
  }

  private findInsertPosition(lines: string[]): number {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.trim() !== '') return i + 1;
    }
    return lines.length;
  }
}
