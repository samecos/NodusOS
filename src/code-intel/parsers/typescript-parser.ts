// ============================================================
// TypeScript/JavaScript Parser — tree-sitter 实现
// ============================================================

import { createRequire } from 'node:module';
import type { Language, Symbol, Reference, SymbolKind } from '../../common/types.js';
import type { LanguageParser, CallEdge } from '../language-parser.js';
import { hashSymbolId } from './utils.js';

const require = createRequire(import.meta.url);
const ParserCtor = (require('tree-sitter') as { default?: new () => TreeSitterParser }).default
  ?? (require('tree-sitter') as new () => TreeSitterParser);

const TypeScriptLang = (require('tree-sitter-typescript') as { typescript: unknown }).typescript as TreeSitterLanguage;
const JavaScriptLang = require('tree-sitter-javascript') as TreeSitterLanguage;

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
  children: TSNode[];
  namedChildren: TSNode[];
  childForFieldName?(name: string): TSNode | null;
  isNamed(): boolean;
}

export class TypeScriptParser implements LanguageParser {
  private parser: TreeSitterParser;
  private tsLang: TreeSitterLanguage;
  private jsLang: TreeSitterLanguage;

  constructor() {
    this.parser = new ParserCtor();
    this.tsLang = TypeScriptLang;
    this.jsLang = JavaScriptLang;
  }

  language(): Language { return 'typescript'; }
  fileExtensions(): string[] { return ['.ts', '.tsx', '.js', '.jsx']; }

  parseSymbols(source: string, filePath: string): Symbol[] {
    this.parser.setLanguage(this.pickLang(filePath));
    const tree = this.parser.parse(source, undefined, { bufferSize: Math.max(32768, Buffer.byteLength(source, 'utf8')) });
    const symbols: Symbol[] = [];
    this.walkNode(tree.rootNode, source, filePath, symbols, null);
    return symbols;
  }

  parseReferences(source: string, symbols: Symbol[]): Reference[] {
    const fp = filePathFromSymbols(symbols);
    this.parser.setLanguage(this.pickLang(fp));
    const tree = this.parser.parse(source, undefined, { bufferSize: Math.max(32768, Buffer.byteLength(source, 'utf8')) });
    const refs: Reference[] = [];
    const symbolMap = new Map<string, Symbol>();
    for (const sym of symbols) symbolMap.set(sym.name, sym);
    this.walkForRefs(tree.rootNode, source, fp, symbolMap, refs);
    return refs;
  }

  parseCallEdges(source: string, symbols: Symbol[]): CallEdge[] {
    const fp = filePathFromSymbols(symbols);
    this.parser.setLanguage(this.pickLang(fp));
    const tree = this.parser.parse(source, undefined, { bufferSize: Math.max(32768, Buffer.byteLength(source, 'utf8')) });
    const edges: CallEdge[] = [];
    this.walkForCallEdges(tree.rootNode, source, fp, edges, undefined);
    return edges;
  }

  // ---- internal ----

  private pickLang(filePath: string) {
    return filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? this.tsLang : this.jsLang;
  }

  private walkNode(
    node: TSNode,
    source: string,
    filePath: string,
    symbols: Symbol[],
    parentId: string | null,
  ): void {
    // 只处理命名节点（有实际类型的节点）
    const kind = this.classifyNode(node);
    if (kind) {
      const name = this.extractName(node);
      if (name) {
        const id = hashSymbolId(filePath, name, kind, node.startPosition.row + 1);
        const sym: Symbol = {
          id, name, kind, language: 'typescript' as Language,
          location: {
            file_path: filePath,
            line_start: node.startPosition.row + 1,
            line_end: node.endPosition.row + 1,
            col_start: node.startPosition.column + 1,
            col_end: node.endPosition.column + 1,
          },
          parent_id: parentId ?? undefined,
          is_exported: this.isExported(source, node),
          signature: this.extractSignature(node),
        };
        symbols.push(sym);

        const isContainer = kind === 'class' || kind === 'interface';
        const childParentId = isContainer ? id : parentId;
        // 递归处理当前节点的 namedChildren（类体的内容）
        for (const child of node.namedChildren) {
          this.walkNode(child, source, filePath, symbols, childParentId);
        }
        return;
      }
    }

    // 继续向下遍历
    for (const child of node.namedChildren) {
      this.walkNode(child, source, filePath, symbols, parentId);
    }
  }

  private walkForRefs(
    node: TSNode,
    source: string,
    filePath: string,
    symbolMap: Map<string, Symbol>,
    refs: Reference[],
  ): void {
    if (node.type === 'call_expression') {
      const fnNode = node.childForFieldName?.('function') ?? node.namedChildren[0];
      if (fnNode) {
        const calleeName = this.resolveCallTarget(fnNode);
        if (calleeName) {
          const target = symbolMap.get(calleeName);
          refs.push({
            id: hashSymbolId(filePath, `ref_${calleeName}`, 'call', node.startPosition.row + 1),
            source_symbol_id: '',
            target_symbol_id: target?.id ?? `unknown:${calleeName}`,
            location: {
              file_path: filePath,
              line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
              col_start: node.startPosition.column + 1, col_end: node.endPosition.column + 1,
            },
            kind: 'call',
          });
        }
      }
    }

    if (node.type === 'new_expression') {
      const fnNode = node.namedChildren[0];
      if (fnNode) {
        const calleeName = this.resolveCallTarget(fnNode);
        if (calleeName) {
          const target = symbolMap.get(calleeName);
          refs.push({
            id: hashSymbolId(filePath, `new_${calleeName}`, 'instantiation', node.startPosition.row + 1),
            source_symbol_id: '',
            target_symbol_id: target?.id ?? `unknown:${calleeName}`,
            location: {
              file_path: filePath,
              line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
              col_start: node.startPosition.column + 1, col_end: node.endPosition.column + 1,
            },
            kind: 'instantiation',
          });
        }
      }
    }

    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'import_specifier') {
          const name = child.text;
          const target = symbolMap.get(name);
          refs.push({
            id: hashSymbolId(filePath, `import_${name}`, 'import', child.startPosition.row + 1),
            source_symbol_id: '',
            target_symbol_id: target?.id ?? `external:${name}`,
            location: {
              file_path: filePath,
              line_start: child.startPosition.row + 1, line_end: child.endPosition.row + 1,
              col_start: child.startPosition.column + 1, col_end: child.endPosition.column + 1,
            },
            kind: 'import',
          });
        }
      }
    }

    // 类型使用
    if (node.type === 'type_identifier') {
      const name = node.text;
      const target = symbolMap.get(name);
      refs.push({
        id: hashSymbolId(filePath, `type_${name}`, 'type_use', node.startPosition.row + 1),
        source_symbol_id: '',
        target_symbol_id: target?.id ?? `external:${name}`,
        location: {
          file_path: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          col_start: node.startPosition.column + 1, col_end: node.endPosition.column + 1,
        },
        kind: 'type_use',
      });
    }

    // 继承关系
    if (node.type === 'extends_clause' || node.type === 'implements_clause') {
      const typeNode = node.namedChildren.find(
        c => c.type === 'type_identifier' || c.type === 'identifier',
      );
      if (typeNode) {
        const name = typeNode.text;
        const target = symbolMap.get(name);
        refs.push({
          id: hashSymbolId(filePath, `inherit_${name}`, 'inheritance', node.startPosition.row + 1),
          source_symbol_id: '',
          target_symbol_id: target?.id ?? `external:${name}`,
          location: {
            file_path: filePath,
            line_start: typeNode.startPosition.row + 1, line_end: typeNode.endPosition.row + 1,
            col_start: typeNode.startPosition.column + 1, col_end: typeNode.endPosition.column + 1,
          },
          kind: 'inheritance',
        });
      }
    }

    // 装饰器
    if (node.type === 'decorator') {
      const callExpr = node.namedChildren.find(c => c.type === 'call_expression');
      const targetNode = callExpr?.childForFieldName?.('function') ?? node.namedChildren[0];
      if (targetNode) {
        const name = this.resolveCallTarget(targetNode);
        if (name) {
          const target = symbolMap.get(name);
          refs.push({
            id: hashSymbolId(filePath, `decorator_${name}`, 'decorator_use', node.startPosition.row + 1),
            source_symbol_id: '',
            target_symbol_id: target?.id ?? `external:${name}`,
            location: {
              file_path: filePath,
              line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
              col_start: node.startPosition.column + 1, col_end: node.endPosition.column + 1,
            },
            kind: 'decorator_use',
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

    if (node.type === 'function_declaration' || node.type === 'method_definition') {
      const nameNode = node.childForFieldName?.('name');
      if (nameNode) currentCaller = nameNode.text;
    }

    if (node.type === 'call_expression' && currentCaller) {
      const fnNode = node.childForFieldName?.('function') ?? node.namedChildren[0];
      if (fnNode && fnNode.type === 'identifier') {
        edges.push({
          caller_name: currentCaller,
          callee_name: fnNode.text,
          location: {
            file_path: filePath,
            line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
            col_start: node.startPosition.column + 1, col_end: node.endPosition.column + 1,
          },
        });
      }
    }

    for (const child of node.namedChildren) {
      this.walkForCallEdges(child, source, filePath, edges, currentCaller);
    }
  }

  // ---- helpers ----

  private classifyNode(node: TSNode): SymbolKind | null {
    switch (node.type) {
      case 'function_declaration': return 'function';
      case 'method_definition': return 'method';
      case 'class_declaration': return 'class';
      case 'interface_declaration': return 'interface';
      case 'type_alias_declaration': return 'type';
      case 'variable_declarator': {
        const hasArrowFn = node.namedChildren.some(
          c => c.type === 'arrow_function' || c.type === 'function_expression'
        );
        return hasArrowFn ? 'variable' : 'variable';
      }
      default: return null;
    }
  }

  private extractName(node: TSNode): string | null {
    const nameNode = node.childForFieldName?.('name');
    if (nameNode) return nameNode.text;
    if (node.type === 'variable_declarator') {
      return node.namedChildren[0]?.text ?? null;
    }
    return null;
  }

  private isExported(source: string, node: TSNode): boolean {
    // 根据 tree-sitter 行/列计算节点在源码中的起始字符偏移
    const lines = source.split('\n');
    let offset = 0;
    for (let i = 0; i < node.startPosition.row; i++) {
      offset += lines[i].length + 1; // +1 为换行符
    }
    offset += node.startPosition.column;

    // 向前截取到行首，检查是否包含 export 关键字
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    const prefix = source.slice(lineStart, offset);
    return /\bexport\b/.test(prefix);
  }

  private extractSignature(node: TSNode): string | undefined {
    const params = node.childForFieldName?.('parameters');
    if (params) return `(${params.text})`;
    if (node.type === 'variable_declarator') {
      const arrowFn = node.namedChildren.find(c => c.type === 'arrow_function');
      if (arrowFn) {
        const p = arrowFn.childForFieldName?.('parameters');
        if (p) return `(${p.text})`;
      }
    }
    return undefined;
  }

  private resolveCallTarget(fnNode: TSNode): string | null {
    if (fnNode.type === 'identifier') return fnNode.text;
    if (fnNode.type === 'member_expression') {
      const parts = fnNode.text.split('.');
      return parts[parts.length - 1] ?? null;
    }
    return null;
  }
}

function filePathFromSymbols(symbols: Symbol[]): string {
  return symbols[0]?.location.file_path ?? 'src/unknown.ts';
}
