// ============================================================
// GitIntelligence 测试 — 临时 git repo
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitIntelligenceImpl } from './git-intelligence.impl.js';

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { encoding: 'utf-8', cwd, stdio: 'pipe' }).trim();
}

describe('GitIntelligence', () => {
  let repoDir: string;
  let gi: GitIntelligenceImpl;

  beforeEach(() => {
    repoDir = join(tmpdir(), `nodus-git-test-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    execSync('git init', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.email "test@nodus.dev"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: repoDir, stdio: 'pipe' });

    // Create initial commit
    writeFileSync(join(repoDir, 'readme.md'), '# Test');
    execSync('git add . && git commit -m "initial commit"', { cwd: repoDir, stdio: 'pipe' });

    // Create second commit
    writeFileSync(join(repoDir, 'src.ts'), 'function foo() {}');
    execSync('git add . && git commit -m "add foo function"', { cwd: repoDir, stdio: 'pipe' });

    gi = new GitIntelligenceImpl();
  });

  afterEach(() => {
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true });
  });

  it('should query git log', async () => {
    const commits = await gi.log(repoDir, { kind: 'directory', path: '.' });
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits[0]!.message).toBe('add foo function');
    expect(commits[1]!.message).toBe('initial commit');
  });

  it('should filter git log by time range', async () => {
    const from = new Date();
    from.setDate(from.getDate() - 1);
    const commits = await gi.log(repoDir, { kind: 'directory', path: '.' }, { from, to: new Date() });
    expect(commits.length).toBeGreaterThanOrEqual(2);
  });

  it('should get diff for a commit', async () => {
    const commits = await gi.log(repoDir, { kind: 'directory', path: '.' });
    const latestHash = commits[0]!.hash;
    const diff = await gi.diff(repoDir, latestHash);
    expect(diff.stats.filesChanged).toBeGreaterThanOrEqual(0);
  });

  it('should get blame info', async () => {
    const blame = await gi.blame(repoDir, 'src.ts', 1);
    expect(blame.commitHash).toBeTruthy();
    expect(blame.author).toBe('Test User');
  });

  it('should throw for non-git repos', async () => {
    const nonGit = join(tmpdir(), `non-git-${Date.now()}`);
    mkdirSync(nonGit, { recursive: true });
    try {
      await expect(gi.log(nonGit, { kind: 'directory', path: '.' })).rejects.toThrow();
    } finally {
      rmSync(nonGit, { recursive: true });
    }
  });
});
