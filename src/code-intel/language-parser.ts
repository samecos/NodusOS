// ============================================================
// LanguageParser — tree-sitter 解析器接口与实现
// 与 ArchitecturalDesignPhase/04-API-Reference.md 架构一致
// ============================================================

import type { Language, Symbol, Reference, SourceLocation } from '../common/types.js';

export interface LanguageParser {
  language(): Language;
  fileExtensions(): string[];
  parseSymbols(source: string, filePath: string): Symbol[];
  parseReferences(source: string, symbols: Symbol[]): Reference[];
  parseCallEdges(source: string, symbols: Symbol[]): CallEdge[];
}

export interface CallEdge {
  caller_name: string;
  callee_name: string;
  location: SourceLocation;
}
