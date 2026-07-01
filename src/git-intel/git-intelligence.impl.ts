// ============================================================
// GitIntelligence 实现 — exec git CLI
// ============================================================

import { execSync } from 'node:child_process';
import type {
  GitIntelligence, CommitInfo, DiffData, DiffHunk, DiffLine,
  DiffStats, BlameInfo, ChangeScope,
} from './git-intelligence.js';

function git(repoPath: string, args: string): string {
  try {
    return execSync(`git ${args}`, { encoding: 'utf-8', cwd: repoPath, stdio: 'pipe' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not a git repository')) throw new Error(`Not a git repo: ${repoPath}`);
    throw new Error(`Git command failed: git ${args}\n${msg}`);
  }
}

export class GitIntelligenceImpl implements GitIntelligence {
  async log(
    repoPath: string,
    scope: ChangeScope,
    timeRange?: { from: Date; to: Date },
    author?: string,
    maxCommits = 20,
  ): Promise<CommitInfo[]> {
    const scopePath = scope.kind === 'file' ? scope.path
      : scope.kind === 'directory' ? scope.path
      : '.';

    let args = `log --format="%H|%h|%s|%an|%aI" --shortstat --max-count=${maxCommits}`;
    if (timeRange) {
      args += ` --since="${timeRange.from.toISOString()}"`;
      if (timeRange.to) args += ` --until="${timeRange.to.toISOString()}"`;
    }
    if (author) args += ` --author="${author}"`;
    args += ` -- ${scopePath}`;

    const output = git(repoPath, args);
    return this.parseLog(output);
  }

  async diff(repoPath: string, commitHash: string): Promise<DiffData> {
    const output = git(repoPath, `diff ${commitHash}^..${commitHash}`);
    return this.parseDiff(output);
  }

  async blame(repoPath: string, filePath: string, line: number): Promise<BlameInfo> {
    const output = git(repoPath, `blame -L ${line},${line} --porcelain ${filePath}`);
    return this.parseBlame(output);
  }

  // ---- parsers ----

  private parseLog(output: string): CommitInfo[] {
    const commits: CommitInfo[] = [];
    const lines = output.split('\n').filter(Boolean);

    let current: Partial<CommitInfo> | null = null;

    for (const line of lines) {
      if (line.startsWith('commit ')) continue;
      const parts = line.split('|');
      if (parts.length === 5) {
        // commit line: hash|shortHash|message|author|timestamp
        if (current) this.finalizeCommit(current, commits);
        current = {
          hash: parts[0]!, shortHash: parts[1]!, message: parts[2]!,
          author: parts[3]!, timestamp: parts[4]!,
          filesChanged: 0, insertions: 0, deletions: 0, changedFileList: [],
        };
      } else if (current && line.includes('file') && line.includes('changed')) {
        const m1 = line.match(/(\d+)\s+files?\s+changed/);
        const m2 = line.match(/(\d+)\s+insertions?/);
        const m3 = line.match(/(\d+)\s+deletions?/);
        current.filesChanged = m1 ? parseInt(m1[1]) : 0;
        current.insertions = m2 ? parseInt(m2[1]) : 0;
        current.deletions = m3 ? parseInt(m3[1]) : 0;
      }
    }
    if (current) this.finalizeCommit(current, commits);

    return commits;
  }

  private finalizeCommit(c: Partial<CommitInfo>, commits: CommitInfo[]): void {
    commits.push({
      hash: c.hash ?? '', shortHash: c.shortHash ?? '',
      message: c.message ?? '', author: c.author ?? '',
      timestamp: c.timestamp ?? '', filesChanged: c.filesChanged ?? 0,
      insertions: c.insertions ?? 0, deletions: c.deletions ?? 0,
      changedFileList: c.changedFileList ?? [],
    });
  }

  private parseDiff(output: string): DiffData {
    const files: DiffData['files'] = [];
    let stats = { filesChanged: 0, insertions: 0, deletions: 0 };

    const lines = output.split('\n');
    let currentFile: DiffData['files'][0] | null = null;

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        if (currentFile) files.push(currentFile);
        const pathMatch = line.match(/b\/(.+)/);
        currentFile = {
          path: pathMatch?.[1] ?? '',
          changeType: 'modified',
          hunks: [],
        };
        stats.filesChanged++;
      } else if (line.startsWith('@@') && currentFile) {
        const hunkMatch = line.match(/@@ -(\d+),?(\d+)? \+(\d+),?(\d+)? @@/);
        currentFile.hunks.push({
          oldStart: parseInt(hunkMatch?.[1] ?? '1'), oldLines: parseInt(hunkMatch?.[2] ?? '1'),
          newStart: parseInt(hunkMatch?.[3] ?? '1'), newLines: parseInt(hunkMatch?.[4] ?? '1'),
          lines: [],
        });
        // 清除旧的当前文件以便新文件插入
        files.push(currentFile);
        currentFile = null;
      } else if (line.startsWith('+')) { stats.insertions++; }
      else if (line.startsWith('-')) { stats.deletions++; }
    }

    return {
      files: files.filter(f => f.path).map(f => ({ ...f, hunks: [] })),
      stats,
    };
  }

  private parseBlame(output: string): BlameInfo {
    const lines = output.split('\n').filter(Boolean);
    // porcelain format: first line has hash, then fields
    const hash = lines[0]?.split(' ')[0] ?? '';
    let author = '';
    let summary = '';

    for (const line of lines) {
      if (line.startsWith('author ')) author = line.slice(7);
      if (line.startsWith('summary ')) summary = line.slice(8);
    }

    return {
      commitHash: hash,
      author,
      timestamp: '',
      summary,
      lineContent: '',
    };
  }
}
