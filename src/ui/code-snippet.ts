// ============================================================
// CodeSnippet — 从文件提取代码片段并进行终端语法高亮
// ============================================================

import { readFileSync } from 'node:fs';
import type { Language } from '../common/types.js';

const BLUE = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function c(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

/** 代码行信息，含原文和是否目标行 */
export interface CodeLine {
  text: string;
  lineNumber: number;
  isTarget: boolean;
}

/**
 * 从文件读取指定行附近的代码片段。
 *
 * @param filePath 源码文件绝对/相对路径
 * @param centerLine 中心行号（1-based）
 * @param contextLines 上下文行数（默认 1，即各取前后 1 行共 3 行）
 * @returns 代码行数组；文件不存在或行号越界时返回空数组
 */
export function readFileSnippet(
  filePath: string,
  centerLine: number,
  contextLines = 1,
): CodeLine[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const start = Math.max(0, centerLine - contextLines - 1);
    const end = Math.min(lines.length, centerLine + contextLines);

    const result: CodeLine[] = [];
    for (let i = start; i < end; i++) {
      result.push({
        text: lines[i] ?? '',
        lineNumber: i + 1,
        isTarget: i + 1 === centerLine,
      });
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * 对代码行应用语法高亮。
 *
 * 当前支持 TypeScript/JavaScript 和 Python 的关键词、字符串、注释、
 * 数字的终端 ANSI 着色。
 *
 * @param codeLine 代码行原文
 * @param language 编程语言
 * @returns 带 ANSI 转义序列的高亮文本
 */
export function highlightLine(codeLine: string, language: Language | string): string {
  if (!codeLine.trim()) return codeLine;

  const lang = language as string;

  // 注释优先（整行着色）
  if (lang === 'python') {
    const commentMatch = codeLine.match(/^(\s*)#(.*)/);
    if (commentMatch) {
      return commentMatch[1]! + c('#' + commentMatch[2]!, DIM);
    }
  } else {
    // JS/TS: // 注释
    const commentMatch = codeLine.match(/^(\s*)\/\/(.*)/);
    if (commentMatch) {
      return commentMatch[1]! + c('//' + commentMatch[2]!, DIM);
    }
  }

  // 字符串高亮
  let result = codeLine.replace(/(['"`])(?:(?!\1).)*?\1/g, match => c(match, GREEN));
  result = result.replace(/(['"`])(?:(?!\1).)*\\\1/g, match => c(match, GREEN));

  // Python f-string prefix
  if (lang === 'python') {
    result = result.replace(/f(['"])(?:(?!\1).)*?\1/g, match => c(match, GREEN));
  }

  // 数字高亮
  result = result.replace(/\b(\d+\.?\d*)\b/g, (_, num) => {
    // 避免给行号前缀着色
    return c(num, YELLOW);
  });

  // 关键词高亮
  const keywords = getKeywords(language as Language);
  for (const kw of keywords) {
    const regex = new RegExp(`\\b(${kw})\\b`, 'g');
    result = result.replace(regex, match => c(match, BLUE));
  }

  return result;
}

/** 渲染单行代码片段，目标行带高亮标记 */
export function renderCodeLine(
  line: CodeLine,
  language: Language | string,
  lineNumWidth: number,
): string {
  const numStr = String(line.lineNumber).padStart(lineNumWidth, ' ');
  const prefix = line.isTarget
    ? c('→ ', BOLD + RED)
    : c('| ', DIM);

  let colored = highlightLine(line.text, language);
  if (line.isTarget) {
    colored = c(colored, BOLD);
  }

  return `${prefix}${c(numStr, DIM)} ${colored}`;
}

/**
 * 渲染完整代码片段，带文件头与上下文行。
 *
 * @param filePath 文件路径
 * @param lines 代码行
 * @param language 编程语言
 * @returns 格式化后的 ANSI 文本
 */
export function renderSnippet(
  filePath: string,
  lines: CodeLine[],
  language: Language | string,
): string {
  if (lines.length === 0) return '';

  const maxLineNum = Math.max(...lines.map(l => l.lineNumber));
  const lineNumWidth = String(maxLineNum).length;

  let out = c(`\n    ${filePath}`, DIM) + '\n';
  for (const line of lines) {
    out += `    ${renderCodeLine(line, language, lineNumWidth)}\n`;
  }
  return out;
}

// ---- 关键词表 ----

function getKeywords(language: Language): string[] {
  if (language === 'python') {
    return [
      'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while',
      'import', 'from', 'as', 'try', 'except', 'finally', 'raise',
      'with', 'yield', 'lambda', 'pass', 'break', 'continue', 'and',
      'or', 'not', 'is', 'in', 'None', 'True', 'False', 'async', 'await',
      'self', 'print', 'global', 'nonlocal', 'del',
    ];
  }
  // TypeScript / JavaScript
  return [
    'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for',
    'while', 'do', 'switch', 'case', 'break', 'continue', 'new',
    'this', 'super', 'class', 'extends', 'implements', 'interface',
    'type', 'enum', 'import', 'export', 'default', 'from', 'as',
    'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield',
    'true', 'false', 'null', 'undefined', 'typeof', 'instanceof',
    'private', 'public', 'protected', 'readonly', 'static', 'abstract',
    'constructor', 'get', 'set', 'void', 'never', 'any', 'unknown',
    'string', 'number', 'boolean', 'symbol', 'object',
    'Promise', 'Array', 'Map', 'Set', 'Error',
  ];
}
