// ============================================================
// TeamCollaboration — 团队协作接口
// 与 ArchitecturalDesignPhase/04-API-Reference.md §R3.6 一致
// 共享格式为 JSON，支持项目索引导出/导入与符号注释
// ============================================================

import type { SymbolId, Symbol, Reference, ProjectMeta } from '../common/types.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';

/** 符号注释 — 团队协作中对符号的文本标注 */
export interface SymbolAnnotation {
  id: string;
  /** 被注释的符号全局 ID */
  symbol_id: SymbolId;
  /** 注释内容 */
  content: string;
  /** 作者标识 */
  author: string;
  /** 创建时间 ISO 8601 */
  created_at: string;
  /** 更新时间 ISO 8601（可选） */
  updated_at?: string;
  /** 标签（可选） */
  tags?: string[];
}

/** 共享索引 JSON 结构 — 团队协作的数据交换格式 */
export interface SharedIndex {
  /** 共享格式版本 */
  version: string;
  /** 导出时间 ISO 8601 */
  exported_at: string;
  /** 项目元数据 */
  project_meta: ProjectMeta;
  /** 导出的符号列表 */
  symbols: Symbol[];
  /** 导出的引用列表 */
  references: Reference[];
  /** 附带的注释（可选） */
  annotations?: SymbolAnnotation[];
}

export interface TeamCollaboration {
  /**
   * 导出项目索引为 JSON 字符串
   * @param projectPath 项目根路径
   * @param store 知识库存储
   * @returns 格式化后的 JSON 字符串（SharedIndex 格式）
   */
  shareIndex(projectPath: string, store: KnowledgeStore): Promise<string>;

  /**
   * 导入共享索引 JSON
   * @param json 符合 SharedIndex 格式的 JSON 字符串
   * @param store 知识库存储（用于写入符号与引用）
   * @returns 导入统计：symbols / references / annotations
   */
  importSharedIndex(
    json: string,
    store: KnowledgeStore,
  ): Promise<{ symbols: number; references: number; annotations: number }>;

  /**
   * 添加符号注释
   * @param annotation 注释数据（不含 id 与 created_at）
   * @returns 生成的完整注释对象
   */
  addAnnotation(
    annotation: Omit<SymbolAnnotation, 'id' | 'created_at'>,
  ): Promise<SymbolAnnotation>;

  /**
   * 列出符号注释
   * @param symbolId 可选：按符号 ID 过滤
   * @returns 注释列表
   */
  listAnnotations(symbolId?: SymbolId): Promise<SymbolAnnotation[]>;

  /**
   * 导出团队知识（项目索引 + 当前注释）为 JSON 字符串
   * @param projectPath 项目根路径
   * @param store 知识库存储
   * @returns 格式化后的 JSON 字符串（SharedIndex 格式，包含 annotations）
   */
  exportTeamKnowledge(projectPath: string, store: KnowledgeStore): Promise<string>;
}
