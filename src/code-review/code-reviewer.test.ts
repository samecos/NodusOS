// ============================================================
// CodeReviewer 单元测试 — TC-UT-CR-001 ~ TC-UT-CR-015
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DefaultCodeReviewer } from './code-reviewer.impl.js';
import type { DiffData, DiffHunk } from '../git-intel/git-intelligence.js';
import { ReviewError } from '../common/errors.js';

function makeDiffData(overrides: Partial<DiffData> = {}): DiffData {
  return {
    files: [],
    stats: { filesChanged: 0, insertions: 0, deletions: 0 },
    ...overrides,
  };
}

function makeFileDiff(path: string, hunks: DiffHunk[], changeType: DiffData['files'][0]['changeType'] = 'modified'): DiffData['files'][0] {
  return { path, changeType, hunks };
}

function makeHunk(lines: Array<{ type: 'added' | 'removed' | 'context'; content: string; oldLine?: number; newLine?: number }>): DiffHunk {
  return {
    oldStart: 1,
    oldLines: lines.length,
    newStart: 1,
    newLines: lines.length,
    lines: lines as DiffHunk['lines'],
  };
}

describe('CodeReviewer', () => {
  let reviewer: DefaultCodeReviewer;
  let repoDir: string;

  beforeEach(() => {
    reviewer = new DefaultCodeReviewer();
    repoDir = join(tmpdir(), `nodus-review-test-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@nodus.dev"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: repoDir, stdio: 'ignore' });
  });

  afterEach(() => {
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
  });

  // ==========================================================
  // TC-UT-CR-001: reviewDiff 对空 diff 返回低风险报告
  // ==========================================================
  it('TC-UT-CR-001: should return low-risk report for empty diff', async () => {
    const diff = makeDiffData();
    const report = await reviewer.reviewDiff(diff);

    expect(report.overallRisk).toBe('low');
    expect(report.stats.filesChanged).toBe(0);
    expect(report.stats.commentsCount).toBe(0);
    expect(report.summary).toContain('低风险');
  });

  // ==========================================================
  // TC-UT-CR-002: 变更范围检测 — 大规模变更
  // ==========================================================
  it('TC-UT-CR-002: should detect large scope change', async () => {
    const files = Array.from({ length: 12 }, (_, i) =>
      makeFileDiff(`src/f${i}.ts`, [makeHunk([{ type: 'added', content: 'const x = 1;', newLine: 1 }])]),
    );
    const diff = makeDiffData({ files, stats: { filesChanged: 12, insertions: 120, deletions: 10 } });

    const report = await reviewer.reviewDiff(diff);

    const scopeComments = report.comments.filter(c => c.dimension === 'scope');
    expect(scopeComments.length).toBeGreaterThan(0);
    expect(scopeComments[0]!.severity).toBe('warning');
    expect(scopeComments[0]!.title).toBe('变更规模较大');
    expect(report.overallRisk).toBe('high');
  });

  // ==========================================================
  // TC-UT-CR-003: 风险检测 — 修改 package.json
  // ==========================================================
  it('TC-UT-CR-003: should flag package.json changes as high risk', async () => {
    const diff = makeDiffData({
      files: [makeFileDiff('package.json', [], 'modified')],
      stats: { filesChanged: 1, insertions: 5, deletions: 2 },
    });

    const report = await reviewer.reviewDiff(diff);

    const risk = report.comments.filter(c => c.dimension === 'risk');
    expect(risk.length).toBeGreaterThan(0);
    expect(risk[0]!.severity).toBe('critical');
    expect(risk[0]!.title).toBe('高风险文件变更');
  });

  // ==========================================================
  // TC-UT-CR-004: 风险检测 — 文件删除
  // ==========================================================
  it('TC-UT-CR-004: should warn on deleted files', async () => {
    const diff = makeDiffData({
      files: [makeFileDiff('src/old.ts', [], 'deleted')],
      stats: { filesChanged: 1, insertions: 0, deletions: 50 },
    });

    const report = await reviewer.reviewDiff(diff);

    const risk = report.comments.filter(c => c.dimension === 'risk');
    expect(risk.some(c => c.title === '文件被删除')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-005: 代码风格 — 行尾空格
  // ==========================================================
  it('TC-UT-CR-005: should detect trailing whitespace', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/a.ts', [
          makeHunk([{ type: 'added', content: 'const x = 1;   ', newLine: 1 }]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const style = report.comments.filter(c => c.dimension === 'style');
    expect(style.some(c => c.title === '行尾存在多余空格')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-006: 代码风格 — console.log 残留
  // ==========================================================
  it('TC-UT-CR-006: should detect console.log in added lines', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/a.ts', [
          makeHunk([{ type: 'added', content: 'console.log("debug");', newLine: 1 }]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const style = report.comments.filter(c => c.dimension === 'style');
    expect(style.some(c => c.title === '包含调试日志语句')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-007: 代码风格 — debugger 语句
  // ==========================================================
  it('TC-UT-CR-007: should flag debugger statement as critical', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/a.ts', [
          makeHunk([{ type: 'added', content: 'debugger;', newLine: 1 }]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const style = report.comments.filter(c => c.dimension === 'style');
    const debuggerComment = style.find(c => c.title === '包含 debugger 语句');
    expect(debuggerComment).toBeDefined();
    expect(debuggerComment!.severity).toBe('critical');
  });

  // ==========================================================
  // TC-UT-CR-008: 潜在 bug — 松散相等运算符
  // ==========================================================
  it('TC-UT-CR-008: should warn on loose equality operators', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/a.ts', [
          makeHunk([
            { type: 'added', content: 'if (x == null) return;', newLine: 1 },
            { type: 'added', content: 'if (y != z) return;', newLine: 2 },
          ]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 2, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const bugs = report.comments.filter(c => c.dimension === 'bug');
    expect(bugs.some(c => c.title === '使用松散相等运算符')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-009: 潜在 bug — any 类型使用
  // ==========================================================
  it('TC-UT-CR-009: should flag usage of any type', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/a.ts', [
          makeHunk([{ type: 'added', content: 'const data: any = fetchData();', newLine: 1 }]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const bugs = report.comments.filter(c => c.dimension === 'bug');
    expect(bugs.some(c => c.title === '使用 any 类型')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-010: 潜在 bug — 空 catch 块
  // ==========================================================
  it('TC-UT-CR-010: should warn on empty catch block', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/a.ts', [
          makeHunk([{ type: 'added', content: 'try { foo(); } catch (e) {}', newLine: 1 }]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const bugs = report.comments.filter(c => c.dimension === 'bug');
    expect(bugs.some(c => c.title === '空的 catch 块')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-011: Python 裸 except 检测
  // ==========================================================
  it('TC-UT-CR-011: should warn on bare except in Python', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/a.py', [
          makeHunk([{ type: 'added', content: 'except:', newLine: 1 }]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const bugs = report.comments.filter(c => c.dimension === 'bug');
    expect(bugs.some(c => c.title === '裸 except 子句')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-012: 评审意见去重
  // ==========================================================
  it('TC-UT-CR-012: should deduplicate identical comments', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/a.ts', [
          makeHunk([
            { type: 'added', content: 'console.log("a");', newLine: 1 },
            { type: 'added', content: 'console.log("b");', newLine: 2 },
          ]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 2, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    // 两行 console.log 不应该产生两条完全相同的评论，因为行号不同
    // 但如果同一行有多个相同规则命中，则应该去重
    const style = report.comments.filter(c => c.dimension === 'style');
    const consoleComments = style.filter(c => c.title === '包含调试日志语句');
    expect(consoleComments.length).toBe(2); // 不同行号，不去重
  });

  // ==========================================================
  // TC-UT-CR-013: reviewCommit 集成测试
  // ==========================================================
  it('TC-UT-CR-013: should review a real commit', async () => {
    writeFileSync(join(repoDir, 'readme.md'), '# init');
    execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });

    writeFileSync(join(repoDir, 'src.ts'), 'const x = 1;\nconsole.log(x);\n');
    execSync('git add . && git commit -m "add src"', { cwd: repoDir, stdio: 'ignore' });

    const commits = execSync('git log --format=%H', { cwd: repoDir, encoding: 'utf-8' }).trim().split('\n');
    const latest = commits[0]!;

    const report = await reviewer.reviewCommit(repoDir, latest);

    expect(report.overallRisk).toBeDefined();
    expect(report.stats.filesChanged).toBeGreaterThan(0);
    // console.log 应该被检测
    expect(report.comments.some(c => c.title === '包含调试日志语句')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-014: reviewPR 集成测试
  // ==========================================================
  it('TC-UT-CR-014: should review diff between branches', async () => {
    writeFileSync(join(repoDir, 'base.txt'), 'base');
    execSync('git add . && git commit -m "base"', { cwd: repoDir, stdio: 'ignore' });

    execSync('git checkout -b feature', { cwd: repoDir, stdio: 'ignore' });
    writeFileSync(join(repoDir, 'feature.ts'), 'const a = 1;\n');
    execSync('git add . && git commit -m "feature"', { cwd: repoDir, stdio: 'ignore' });

    const report = await reviewer.reviewPR(repoDir, 'main', 'feature');

    expect(report.stats.filesChanged).toBeGreaterThan(0);
    expect(report.summary).toContain('个文件');
  });

  // ==========================================================
  // TC-UT-CR-015: 非 git 仓库应抛出 ReviewError
  // ==========================================================
  it('TC-UT-CR-015: should throw ReviewError for non-git repo', async () => {
    const nonGit = join(tmpdir(), `non-git-${Date.now()}`);
    mkdirSync(nonGit, { recursive: true });

    try {
      await expect(reviewer.reviewCommit(nonGit, 'abc123')).rejects.toThrow(ReviewError);
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  // ==========================================================
  // TC-UT-CR-016: 过长的行检测
  // ==========================================================
  it('TC-UT-CR-016: should detect overly long lines', async () => {
    const longLine = 'x'.repeat(145);
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/a.ts', [
          makeHunk([{ type: 'added', content: longLine, newLine: 1 }]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const style = report.comments.filter(c => c.dimension === 'style');
    expect(style.some(c => c.title === '行长度超过 120 字符')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-017: 源码与测试同时变更提示
  // ==========================================================
  it('TC-UT-CR-017: should hint when source and tests change together', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/payment.ts', [
          makeHunk([{ type: 'added', content: 'function pay() {}', newLine: 1 }]),
        ]),
        makeFileDiff('src/payment.test.ts', [
          makeHunk([{ type: 'added', content: 'it("works", () => {});', newLine: 1 }]),
        ]),
      ],
      stats: { filesChanged: 2, insertions: 2, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const scope = report.comments.filter(c => c.dimension === 'scope');
    expect(scope.some(c => c.title === '源码与测试同时变更')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-018: 文件重命名检测
  // ==========================================================
  it('TC-UT-CR-018: should warn on renamed files', async () => {
    const diff = makeDiffData({
      files: [makeFileDiff('src/new-name.ts', [], 'renamed')],
      stats: { filesChanged: 1, insertions: 0, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const risk = report.comments.filter(c => c.dimension === 'risk');
    expect(risk.some(c => c.title === '文件重命名')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-019: TODO 注释检测
  // ==========================================================
  it('TC-UT-CR-019: should flag TODO comments', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('src/a.ts', [
          makeHunk([{ type: 'added', content: '// TODO: refactor this later', newLine: 1 }]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const style = report.comments.filter(c => c.dimension === 'style');
    expect(style.some(c => c.title === '包含临时注释标记')).toBe(true);
  });

  // ==========================================================
  // TC-UT-CR-020: 非源码文件不做风格/bug 检测
  // ==========================================================
  it('TC-UT-CR-020: should skip style/bug checks for non-source files', async () => {
    const diff = makeDiffData({
      files: [
        makeFileDiff('README.md', [
          makeHunk([{ type: 'added', content: 'console.log("in markdown");', newLine: 1 }]),
        ]),
      ],
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });

    const report = await reviewer.reviewDiff(diff);

    const style = report.comments.filter(c => c.dimension === 'style');
    const bugs = report.comments.filter(c => c.dimension === 'bug');
    expect(style.length).toBe(0);
    expect(bugs.length).toBe(0);
  });
});
