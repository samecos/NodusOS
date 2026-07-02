// ============================================================
// Nodus Core Types — 与 docs/07-detailed-design.md 一致
// ============================================================

/** 符号全局唯一标识符 */
export type SymbolId = string;

/** 编程语言 */
export type Language = 'typescript' | 'javascript' | 'python';

/** 符号种类 */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'parameter'
  | 'module'
  | 'decorator';

/** 源码位置 */
export interface SourceLocation {
  file_path: string;
  line_start: number;
  line_end: number;
  col_start: number;
  col_end: number;
}

/** 符号定义 */
export interface Symbol {
  id: SymbolId;
  name: string;
  kind: SymbolKind;
  language: Language;
  location: SourceLocation;
  parent_id?: SymbolId;
  is_exported: boolean;
  signature?: string;
  doc_comment?: string;
}

/** 引用类型 */
export type ReferenceKind =
  | 'call'
  | 'import'
  | 'inheritance'
  | 'interface_implements'
  | 'type_use'
  | 'instantiation'
  | 'override'
  | 'decorator_use';

/** 引用关系 */
export interface Reference {
  id: string;
  source_symbol_id: SymbolId;
  target_symbol_id: SymbolId;
  location: SourceLocation;
  kind: ReferenceKind;
}

/** import 绑定信息 */
export interface ImportBinding {
  source: string;
  kind: 'named' | 'default' | 'namespace';
  localName: string;
  importedName: string;
  location: SourceLocation;
}

/** re-export 信息：index.ts 中 `export { foo } from './foo'` */
export interface ReexportInfo {
  name: string;
  source: string;
  location: SourceLocation;
}

/** 调用方向 */
export type CallDirection = 'callers' | 'callees' | 'both';

/** 调用图节点 */
export interface CallGraphNode {
  symbol_id: SymbolId;
  symbol_name: string;
  file_path: string;
  line: number;
  depth: number;
  has_risk?: boolean;
}

/** 调用图边 */
export interface CallGraphEdge {
  from: SymbolId;
  to: SymbolId;
  kind: ReferenceKind;
}

/** 调用图 */
export interface CallGraph {
  root_symbol_id: SymbolId;
  direction: CallDirection;
  max_depth: number;
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
}

/** 包管理器 */
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'pip' | 'poetry' | 'uv';

/** 框架 */
export type Framework =
  | 'react' | 'nextjs' | 'vue' | 'svelte' | 'express' | 'hono' | 'nestjs'
  | 'fastapi' | 'flask' | 'django';

/** 依赖类型 */
export type DependencyType = 'production' | 'development' | 'peer' | 'optional';

/** 运行时依赖 */
export interface RuntimeRequirement {
  language: Language;
  constraint: string;
  specified_in: string;
}

/** 项目依赖 */
export interface Dependency {
  name: string;
  version: string;
  dep_type: DependencyType;
  language: Language;
}

/** 项目元数据 */
export interface ProjectMeta {
  name: string;
  root_path: string;
  languages: Language[];
  runtimes: RuntimeRequirement[];
  package_manager?: PackageManager;
  dependencies: Dependency[];
  framework?: Framework;
}

/** 查询历史条目 */
export interface QueryHistoryEntry {
  raw_text: string;
  intent_type?: string;
  entities?: Record<string, unknown>;
  context_file?: string;
  context_symbol?: string;
  confidence?: number;
  latency_ms: number;
  result_count: number;
  timestamp: string;
}

/** 索引状态 */
export type IndexStatus =
  | { kind: 'idle' }
  | { kind: 'scanning'; files_found: number }
  | { kind: 'indexing'; progress: number; current_file: string }
  | { kind: 'ready'; symbol_count: number; last_indexed: string }
  | { kind: 'updating'; progress: number; changed_files: number }
  | { kind: 'error'; message: string; recoverable: boolean };

/** 意图类型 */
export type IntentType =
  | 'find_definition'
  | 'find_references'
  | 'call_graph'
  | 'impact_analysis'
  | 'change_history'
  | 'symbol_overview'
  | 'list_symbols'
  | 'stats'
  | 'analytics';

/** 变更范围 */
export type ChangeScope =
  | { kind: 'file'; path: string }
  | { kind: 'directory'; path: string }
  | { kind: 'symbol'; id: SymbolId };

/** 风险级别 */
export type RiskLevel = 'low' | 'medium' | 'high';

/** 文件索引状态 */
export interface FileIndexState {
  file_path: string;
  checksum: string;
  symbol_count: number;
  indexed_at: string;
  error?: string;
}
