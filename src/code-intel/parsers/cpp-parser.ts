// ============================================================
// C/C++ Parser — 轻量级正则实现（函数定义 + 调用引用）
//
// 说明：
// - 目前 tree-sitter 系列仅安装了 JS/TS/Python，因此 C++ 解析采用
//   基于正则的启发式方案，足够支撑 OpenCV 这类大型 C++ 项目中的
//   "找定义 / 找调用 / 调用链路" 查询。
// - 覆盖 .cpp/.cc/.cxx/.hpp/.h，支持命名空间/类限定名。
// ============================================================

import type { Language, Symbol, Reference, SymbolKind } from '../../common/types.js';
import type { LanguageParser, CallEdge } from '../language-parser.js';
import { hashSymbolId } from './utils.js';
import type { ParsedFile } from './plugin-system.js';

const CONTROL_KEYWORDS = new Set([
  'if', 'while', 'for', 'switch', 'catch', 'return', 'sizeof', 'alignof', 'alignas',
  'static_assert', 'decltype', 'noexcept', 'using', 'new', 'delete', 'throw', 'else', 'do',
]);

/** 从限定名中提取简单名，例如 cv::stereoRectify -> stereoRectify */
function simpleName(qualified: string): string {
  const idx = qualified.lastIndexOf('::');
  const name = idx >= 0 ? qualified.slice(idx + 2) : qualified;
  return name;
}

export class CppParser implements LanguageParser {
  language(): Language { return 'cpp'; }
  fileExtensions(): string[] { return ['.cpp', '.cc', '.cxx', '.hpp', '.h']; }

  get name(): string { return 'cpp'; }
  get extensions(): string[] { return this.fileExtensions(); }

  parse(filePath: string, content: string): ParsedFile {
    const symbols = this.parseSymbols(content, filePath);
    const references = this.parseReferences(content, symbols);
    const callEdges = this.parseCallEdges(content, symbols);
    return { symbols, references, callEdges };
  }

  parseSymbols(source: string, filePath: string): Symbol[] {
    const symbols: Symbol[] = [];
    const lines = source.split(/\r?\n/);
    const controlRegex = /\b(if|while|for|switch|catch)\s*$/;
    const qualifierRegex = /^(?:const|volatile|override|final|noexcept|&|&&|=\s*0|=\s*default|=\s*delete)?\s*\{/;
    const disallowedNames = new Set(['auto', 'class', 'struct', 'enum', 'union', 'namespace', 'template', 'return', 'delete', 'new', 'using']);

    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      const trimmed = this.stripLineComment(raw).trim();
      if (!trimmed) { i++; continue; }

      const parenIdx = trimmed.indexOf('(');
      if (parenIdx <= 0 || controlRegex.test(trimmed.slice(0, parenIdx))) { i++; continue; }

      const beforeParen = trimmed.slice(0, parenIdx);
      const nameMatch = beforeParen.match(/(\b[~]?\w+(?:::\w+)*)\s*$/);
      if (!nameMatch) { i++; continue; }
      const qualified = nameMatch[1];
      const simple = simpleName(qualified);
      if (CONTROL_KEYWORDS.has(simple) || disallowedNames.has(simple)) { i++; continue; }

      // 追踪跨行的圆括号深度，找到参数列表结束位置
      let depth = 0;
      let sigEndLine = -1;
      let closeCol = -1;
      outer:
      for (let j = i; j < lines.length; j++) {
        const text = this.stripLineComment(lines[j]);
        for (let k = 0; k < text.length; k++) {
          if (text[k] === '(') depth++;
          else if (text[k] === ')') {
            depth--;
            if (depth === 0) {
              sigEndLine = j;
              closeCol = k;
              break outer;
            }
          }
        }
      }
      if (sigEndLine < 0) { i++; continue; }

      // 判断紧接着的是否为函数体 '{'（同行或下一行）
      let bodyLine = -1;
      const sigEndText = this.stripLineComment(lines[sigEndLine]).trim();
      const afterClose = sigEndText.slice(sigEndText.indexOf(')') + 1).trim();
      if (qualifierRegex.test(afterClose)) {
        bodyLine = sigEndLine;
      } else {
        for (let k = sigEndLine + 1; k < lines.length && k <= sigEndLine + 1; k++) {
          const t = this.stripLineComment(lines[k]).trim();
          if (!t) continue;
          if (t.startsWith('{') || qualifierRegex.test(t)) {
            bodyLine = k;
            break;
          }
          break; // 中间出现非空非 '{' 行，说明不是函数定义
        }
      }
      if (bodyLine < 0) { i = sigEndLine + 1; continue; }

      // 提取函数签名参数
      const sigText = lines.slice(i, sigEndLine + 1).join('\n');
      const openIdx = sigText.indexOf('(');
      const closeIdx = sigText.lastIndexOf(')');
      const params = sigText.slice(openIdx + 1, closeIdx);

      const startLine = i + 1;
      const id = hashSymbolId(filePath, simple, 'function', startLine);
      const kind: SymbolKind = qualified.includes('::') ? 'method' : 'function';

      symbols.push({
        id,
        name: simple,
        kind,
        language: 'cpp',
        location: {
          file_path: filePath,
          line_start: startLine,
          line_end: bodyLine + 1,
          col_start: 1,
          col_end: lines[bodyLine].length + 1,
        },
        is_exported: true,
        signature: `(${params.trim()})`,
      });

      i = bodyLine + 1; // 跳过函数体，避免内部调用被误识别为定义
    }

    return symbols;
  }

  parseReferences(source: string, symbols: Symbol[]): Reference[] {
    const refs: Reference[] = [];
    const filePath = symbols[0]?.location.file_path ?? 'src/unknown.cpp';

    // 按名称分组并排序，解析调用时优先选择调用位置之前的同名定义
    const symbolGroups = new Map<string, Symbol[]>();
    for (const sym of symbols) {
      if (!symbolGroups.has(sym.name)) symbolGroups.set(sym.name, []);
      symbolGroups.get(sym.name)!.push(sym);
    }
    for (const arr of symbolGroups.values()) {
      arr.sort((a, b) => a.location.line_start - b.location.line_start);
    }
    const findNearest = (name: string, line: number): Symbol | undefined => {
      const arr = symbolGroups.get(name);
      if (!arr) return undefined;
      let best: Symbol | undefined;
      for (const sym of arr) {
        if (sym.location.line_start <= line) best = sym;
        else break;
      }
      return best ?? arr[0];
    };

    const lineStarts = this.buildLineStarts(source);
    const callRegex = /(?<![\w:])([A-Za-z_]\w*(?:::\w+)*)\s*\(/g;

    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(source)) !== null) {
      const qualified = match[1] ?? '';
      const simple = simpleName(qualified);
      if (!simple || CONTROL_KEYWORDS.has(simple)) continue;

      const pos = this.positionAt(lineStarts, match.index + (qualified.length - simple.length));
      const target = findNearest(simple, pos.line);

      refs.push({
        id: hashSymbolId(filePath, `call_${simple}`, 'call', pos.line),
        source_symbol_id: '',
        target_symbol_id: target?.id ?? `unknown:${simple}`,
        location: {
          file_path: filePath,
          line_start: pos.line,
          line_end: pos.line,
          col_start: pos.col,
          col_end: pos.col + simple.length,
        },
        kind: 'call',
      });
    }

    return refs;
  }

  parseCallEdges(_source: string, _symbols: Symbol[]): CallEdge[] {
    // CodeIntelligenceImpl 通过 references 构建调用图，
    // callEdges 字段在当前流程中未被持久化，因此直接返回空数组。
    return [];
  }

  // ---- helpers ----

  private stripLineComment(line: string): string {
    const idx = line.indexOf('//');
    return idx >= 0 ? line.slice(0, idx) : line;
  }

  private buildLineStarts(source: string): number[] {
    const starts: number[] = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') starts.push(i + 1);
    }
    return starts;
  }

  private positionAt(lineStarts: number[], index: number): { line: number; col: number } {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: index - lineStarts[lo] + 1 };
  }
}
