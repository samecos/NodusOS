// ============================================================
// CodeReviewer — 代码评审助手接口
// 分析维度：变更范围、风险等级、代码风格、潜在 bug
// ============================================================

import type { DiffData } from '../git-intel/git-intelligence.js';

/** 评审维度 */
export type ReviewDimension = 'scope' | 'risk' | 'style' | 'bug';

/** 评审意见严重级别 */
export type ReviewSeverity = 'info' | 'warning' | 'critical';

/** 单条评审意见 */
export interface ReviewComment {
  /** 评审维度 */
  dimension: ReviewDimension;
  /** 严重级别 */
  severity: ReviewSeverity;
  /** 目标文件路径 */
  filePath: string;
  /** 起始行号（1-based，上下文行则为 0） */
  lineStart: number;
  /** 结束行号（含，与 lineStart 相同时表示单行） */
  lineEnd: number;
  /** 简短标题 */
  title: string;
  /** 详细说明 */
  message: string;
  /** 改进建议（可选） */
  suggestion?: string;
}

/** 评审报告 */
export interface ReviewReport {
  /** 评审摘要 */
  summary: string;
  /** 变更统计 */
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    commentsCount: number;
  };
  /** 总体风险等级 */
  overallRisk: 'low' | 'medium' | 'high';
  /** 评审意见列表，按维度分组 */
  comments: ReviewComment[];
}

export interface CodeReviewer {
  /**
   * 分析已有的 diff 数据并生成评审报告。
   * @param diff 结构化 diff 数据
   * @param projectPath 项目根路径（用于补充上下文，可选）
   */
  reviewDiff(diff: DiffData, projectPath?: string): Promise<ReviewReport>;

  /**
   * 评审单个提交。
   * @param repoPath git 仓库路径
   * @param commitHash 提交哈希
   */
  reviewCommit(repoPath: string, commitHash: string): Promise<ReviewReport>;

  /**
   * 评审两个分支/引用之间的差异（PR 评审）。
   * @param repoPath git 仓库路径
   * @param baseBranch 基准分支
   * @param headBranch 目标分支
   */
  reviewPR(repoPath: string, baseBranch: string, headBranch: string): Promise<ReviewReport>;
}
