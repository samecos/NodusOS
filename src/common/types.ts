// ============================================================
// Nodus Core Types — 与 docs/07-detailed-design.md 一致
// ============================================================

/** 符号全局唯一标识符 */
export type SymbolId = string;

/** 编程语言 */
export type Language = 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'java' | 'csharp' | 'cpp';

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

/** 每个项目的会话状态（最后打开的文件与光标位置） */
export interface SessionState {
  project_root: string;
  active_file: string | null;
  cursor_line: number | null;
  cursor_col: number | null;
  cursor_symbol: string | null;
  updated_at?: string;
}

/** 人工标注条目 — 用于 AI 生成结果的人工反馈与训练数据积累 */
export interface AnnotationEntry {
  id?: number;
  query_history_id?: number;
  input_text: string;
  intent_type: string;
  output_data: string;
  user_rating?: number | null;
  user_correction?: string | null;
  created_at?: string;
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
  | 'analytics'
  | 'type_relationships'
  | 'code_review'
  | 'switch_project'
  | 'list_projects'
  | 'recent_changes'
  | 'view_annotated'
  | 'chunk_brief'
  | 'confirm_reviewed'
  | 'prune_conventions';

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

/** 同步数据包 — 多设备同步的核心数据结构 */
export interface SyncData {
  /** 数据格式版本 */
  version: number;
  /** 导出设备标识 */
  deviceId: string;
  /** 导出时间戳（ISO 8601） */
  exportedAt: string;
  /** 查询历史 */
  queryHistory: QueryHistoryEntry[];
  /** 用户偏好设置 */
  preferences: Record<string, unknown>;
  /** 项目列表 */
  projects: ProjectMeta[];
  /** 会话状态 */
  sessionStates: SessionState[];
  /** 反馈数据（feedback.jsonl 的原始行） */
  feedbackEntries: string[];
}
export interface FileIndexState {
  file_path: string;
  checksum: string;
  symbol_count: number;
  indexed_at: string;
  error?: string;
}

/** 单个代码变更记录（git diff 兼容的统一差异格式） */
export interface CodeChange {
  file_path: string;
  change_type: 'modified' | 'added' | 'deleted' | 'renamed';
  old_start_line?: number;
  old_end_line?: number;
  new_start_line?: number;
  new_end_line?: number;
  old_code?: string;
  new_code?: string;
  diff_text: string;
}

// ============================================================
// 理解层类型 — 人与 AI 代码产出对齐
// ============================================================

/** 审查动作 */
export type ReviewAction = 'pass' | 'dig' | 'reject';

/** 变更批次中一个被改动的符号快照 */
export interface ChangedSymbol {
  symbol_id: SymbolId;
  name: string;
  file_path: string;
  line_start: number;
  line_end: number;
  /** 该符号在这批变更中的 diff 文本 */
  diff_text: string;
}

/** 变更批次 — ChangeSensor 产出的原子单位 */
export interface ChangeBatch {
  /** 唯一标识（时间戳 + 文件数哈希） */
  id: string;
  /** 项目根路径 */
  project_root: string;
  /** 批次检测时间（ISO 8601） */
  detected_at: string;
  /** 受影响文件列表 */
  files: string[];
  /** 受影响符号列表 */
  symbols: ChangedSymbol[];
  /** 工作树快照（文件路径 → 内容），代表"AI 刚交付"状态 */
  snapshot: Record<string, string>;
}

/** 理解债条目 */
export interface DebtEntry {
  symbol_id: string;
  file_path: string;
  debt: number;
  change_recency: number;
  difficulty: number;
  examined_at: number | null;
  confirmed_at: number | null;
  updated_at: number;
}

/** 代码修正标注记录（区别于意图反馈的 AnnotationEntry） */
export interface CodeAnnotationRecord {
  id?: number;
  ai_generated_code: string;
  human_modified_code: string;
  diff: string;
  symbols_involved: string;
  annotation_tags: string;
  chunk_id: string | null;
  brief_field_hits: string | null;
  action: ReviewAction;
  debt_at_review: number | null;
  created_at: string;
}

/** 约定模式 */
export interface Convention {
  tag: string;
  pattern_desc: string;
  occurrences: number;
  symbol_examples: string | null;
  last_seen: number;
}

/** 语义块 */
export interface SemanticChunk {
  id: string;
  symbols: ChangedSymbol[];
  files: string[];
  title: string;
}

/** 简报卡 */
export interface BriefCard {
  chunk_id: string;
  title: string;
  symbols: { name: string; complexity: number }[];
  impact_radius: number;
  risk_level: RiskLevel;
  complexity_hotspots: string[];
  test_coverage: boolean;
  known_issues: string[];
  suggested_inspect_point: { file: string; line: number } | null;
}
