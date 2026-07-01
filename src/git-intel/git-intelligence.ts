// ============================================================
// GitIntelligence — git 操作封装
// 与 ArchitecturalDesignPhase/04-API-Reference.md §7 一致
// ============================================================

import type { SymbolId, ReferenceKind, SourceLocation } from '../common/types.js';

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  changedFileList: string[];
}

export interface DiffData {
  files: FileDiff[];
  stats: DiffStats;
}

export interface FileDiff {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface BlameInfo {
  commitHash: string;
  author: string;
  timestamp: string;
  summary: string;
  lineContent: string;
}

export type ChangeScope =
  | { kind: 'file'; path: string }
  | { kind: 'directory'; path: string }
  | { kind: 'symbol'; id: SymbolId };

export interface GitIntelligence {
  log(
    repoPath: string,
    scope: ChangeScope,
    timeRange?: { from: Date; to: Date },
    author?: string,
    maxCommits?: number,
  ): Promise<CommitInfo[]>;

  diff(repoPath: string, commitHash: string): Promise<DiffData>;

  blame(repoPath: string, filePath: string, line: number): Promise<BlameInfo>;
}
