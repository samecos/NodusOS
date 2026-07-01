// ============================================================
// Python Parser — tree-sitter 实现
// ============================================================

import { createRequire } from 'node:module';
import type { Language, Symbol, Reference, SymbolKind } from '../../common/types.js';
import type { LanguageParser, CallEdge } from '../language-parser.js';
import { hashSymbolId } from './utils.js';

const require = createRequire(import.meta.url);
const ParserCtor = (require('tree-sitter') as { default?: new () => TreeSitterParser }).default
  ?? (require('tree-sitter') as new () => TreeSitterParser);

const PythonLang = require('tree-sitter-python') as TreeSitterLanguage;

interface TreeSitterParser {
  setLanguage(lang: TreeSitterLanguage): void;
  parse(source: string, oldTree?: unknown, options?: { bufferSize?: number }): { rootNode: TSNode };
}

interface TreeSitterLanguage { /* opaque */ }

interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  namedChildren: TSNode[];
  childForFieldName?(name: string): TSNode | null;
}

export class PythonParser implements LanguageParser {
  private parser: TreeSitterParser;
  private pyLang: TreeSitterLanguage;

  constructor() {
    this.parser = new ParserCtor();
    this.pyLang = PythonLang;
  }

  language(): Language { return 'python'; }
  fileExtensions(): string[] { return ['.py']; }

  parseSymbols(source: string, filePath: string): Symbol[] {
    this.parser.setLanguage(this.pyLang);
    const tree = this.parser.parse(source, undefined, { bufferSize: Math.max(32768, Buffer.byteLength(source, 'utf8')) });
    const symbols: Symbol[] = [];
    this.walkNode(tree.rootNode, source, filePath, symbols, null, false);
    return symbols;
  }

  parseReferences(source: string, symbols: Symbol[]): Reference[] {
    this.parser.setLanguage(this.pyLang);
    const tree = this.parser.parse(source, undefined, { bufferSize: Math.max(32768, Buffer.byteLength(source, 'utf8')) });
    const refs: Reference[] = [];
    const symbolMap = new Map<string, Symbol>();
    for (const sym of symbols) symbolMap.set(sym.name, sym);

    this.walkForRefs(tree.rootNode, source, 'src/test.py', symbolMap, refs);
    return refs;
  }

  parseCallEdges(source: string, symbols: Symbol[]): CallEdge[] {
    this.parser.setLanguage(this.pyLang);
    const tree = this.parser.parse(source, undefined, { bufferSize: Math.max(32768, Buffer.byteLength(source, 'utf8')) });
    const edges: CallEdge[] = [];
    const filePath = symbols[0]?.location.file_path ?? 'src/test.py';

    this.walkForCallEdges(tree.rootNode, source, filePath, edges, undefined);
    return edges;
  }

  private walkNode(
    node: TSNode,
    source: string,
    filePath: string,
    symbols: Symbol[],
    parentId: string | null,
    insideClass: boolean,
  ): void {
    let kind: SymbolKind | null = null;

    switch (node.type) {
      case 'function_definition':
        kind = insideClass ? 'method' : 'function';
        break;
      case 'class_definition':
        kind = 'class';
        break;
    }

    if (kind) {
      const nameNode = node.childForFieldName?.('name');
      const name = nameNode?.text ?? null;
      if (name) {
        const id = hashSymbolId(filePath, name, kind, node.startPosition.row + 1);
        symbols.push({
          id, name, kind,
          language: 'python',
          location: {
            file_path: filePath,
            line_start: node.startPosition.row + 1,
            line_end: node.endPosition.row + 1,
            col_start: node.startPosition.column + 1,
            col_end: node.endPosition.column + 1,
          },
          parent_id: parentId ?? undefined,
          is_exported: !name.startsWith('_'),
        });

        // 递归处理类体内部 — 传递 insideClass 标志
        const isClass = kind === 'class';
        for (const child of node.namedChildren) {
          this.walkNode(child, source, filePath, symbols, isClass ? id : parentId, isClass || insideClass);
        }
        return;
      }
    }

    // 继续遍历
    for (const child of node.namedChildren) {
      this.walkNode(child, source, filePath, symbols, parentId, insideClass);
    }
  }

  private walkForRefs(
    node: TSNode,
    source: string,
    filePath: string,
    symbolMap: Map<string, Symbol>,
    refs: Reference[],
  ): void {
    // 函数调用: call_expression → 找 function 字段
    if (node.type === 'call') {
      const fnNode = node.childForFieldName?.('function');
      if (fnNode) {
        const calleeName = this.resolvePyCallTarget(fnNode);
        if (calleeName) {
          const target = symbolMap.get(calleeName);
          refs.push({
            id: `py_ref_${calleeName}_${node.startPosition.row + 1}`,
            source_symbol_id: '',
            target_symbol_id: target?.id ?? `py:${calleeName}`,
            location: {
              file_path: filePath,
              line_start: node.startPosition.row + 1,
              line_end: node.endPosition.row + 1,
              col_start: node.startPosition.column + 1,
              col_end: node.endPosition.column + 1,
            },
            kind: 'call',
          });
        }
      }
    }

    // import foo
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' || child.type === 'aliased_import') {
          const name = child.type === 'aliased_import'
            ? child.childForFieldName?.('name')?.text ?? child.text.split(' ')[0]
            : child.text;
          refs.push({
            id: `py_import_${name}_${child.startPosition.row + 1}`,
            source_symbol_id: '',
            target_symbol_id: `py:${name}`,
            location: {
              file_path: filePath,
              line_start: child.startPosition.row + 1,
              line_end: child.endPosition.row + 1,
              col_start: child.startPosition.column + 1,
              col_end: child.endPosition.column + 1,
            },
            kind: 'import',
          });
        }
      }
    }

    // from foo import bar
    if (node.type === 'import_from_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' || child.type === 'aliased_import') {
          const name = child.type === 'aliased_import'
            ? child.childForFieldName?.('name')?.text ?? child.text.split(' ')[0]
            : child.text;
          refs.push({
            id: `py_import_${name}_${child.startPosition.row + 1}`,
            source_symbol_id: '',
            target_symbol_id: `py:${name}`,
            location: {
              file_path: filePath,
              line_start: child.startPosition.row + 1,
              line_end: child.endPosition.row + 1,
              col_start: child.startPosition.column + 1,
              col_end: child.endPosition.column + 1,
            },
            kind: 'import',
          });
        }
      }
    }

    for (const child of node.namedChildren) {
      this.walkForRefs(child, source, filePath, symbolMap, refs);
    }
  }

  private walkForCallEdges(
    node: TSNode,
    source: string,
    filePath: string,
    edges: CallEdge[],
    callerName: string | undefined,
  ): void {
    let currentCaller = callerName;

    // 函数定义 — 记录当前函数名
    if (node.type === 'function_definition') {
      const nameNode = node.childForFieldName?.('name');
      if (nameNode) currentCaller = nameNode.text;
    }

    // 函数调用 — 如果在函数内部
    if (node.type === 'call' && currentCaller) {
      const fnNode = node.childForFieldName?.('function');
      if (fnNode) {
        const calleeName = this.resolvePyCallTarget(fnNode);
        if (calleeName) {
          edges.push({
            caller_name: currentCaller,
            callee_name: calleeName,
            location: {
              file_path: filePath,
              line_start: node.startPosition.row + 1,
              line_end: node.endPosition.row + 1,
              col_start: node.startPosition.column + 1,
              col_end: node.endPosition.column + 1,
            },
          });
        }
      }
    }

    for (const child of node.namedChildren) {
      this.walkForCallEdges(child, source, filePath, edges, currentCaller);
    }
  }

  private resolvePyCallTarget(fnNode: TSNode): string | null {
    // identifier: foo()
    if (fnNode.type === 'identifier') return fnNode.text;
    // attribute: obj.foo() → 取 foo
    if (fnNode.type === 'attribute') {
      const attr = fnNode.childForFieldName?.('attribute');
      if (attr) return attr.text;
      // fallback: namedChildren 中最后一个
      const named = fnNode.namedChildren;
      return named.length > 0 ? named[named.length - 1]!.text : null;
    }
    return null;
  }
}
