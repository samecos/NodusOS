// ============================================================
// DefaultCodeReviewer — 代码评审助手实现
// 基于规则/启发式的静态分析，不依赖外部 AI API。
// ============================================================

import { execSync } from 'node:child_process';
import type {
  DiffData, DiffHunk, DiffLine,
} from '../git-intel/git-intelligence.js';
import { parseDiffOutput } from '../git-intel/git-intelligence.impl.js';
import type {
  CodeReviewer, ReviewComment, ReviewReport, ReviewDimension, ReviewSeverity,
} from './code-reviewer.js';
import { ReviewError } from '../common/errors.js';

/** 高风险文件模式 */
const HIGH_RISK_PATTERNS = [
  /package\.json$/,
  /tsconfig\.json$/,
  /\.env/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /Dockerfile$/,
  /\.github\//,
  /\.gitlab-ci/,
  /deploy/,
  /migration/,
];

/** 源码扩展名（用于判断是否需要做代码风格/bug 检测） */
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);

function isSourceFile(path: string): boolean {
  const idx = path.lastIndexOf('.');
  if (idx === -1) return false;
  return SOURCE_EXTS.has(path.slice(idx));
}

function isHighRiskFile(path: string): boolean {
  return HIGH_RISK_PATTERNS.some(p => p.test(path));
}

export class DefaultCodeReviewer implements CodeReviewer {
  async reviewDiff(diff: DiffData, _projectPath?: string): Promise<ReviewReport> {
    const comments: ReviewComment[] = [];
    const { files, stats } = diff;

    // 1. 变更范围分析
    comments.push(...this.analyzeScope(files, stats));

    // 2. 风险等级分析（文件级）
    comments.push(...this.analyzeRisk(files));

    // 3. 代码风格 & 潜在 bug（逐行分析 added 行）
    for (const file of files) {
      if (!isSourceFile(file.path)) continue;
      for (const hunk of file.hunks) {
        comments.push(...this.analyzeHunkStyle(file.path, hunk));
        comments.push(...this.analyzeHunkBugs(file.path, hunk));
      }
    }

    // 去重：相同文件+行号+维度+标题只保留一条
    const deduped = this.deduplicate(comments);

    // 计算总体风险
    const overallRisk = this.computeOverallRisk(deduped, stats);

    const summary = this.buildSummary(stats, deduped, overallRisk);

    return {
      summary,
      stats: {
        filesChanged: stats.filesChanged,
        insertions: stats.insertions,
        deletions: stats.deletions,
        commentsCount: deduped.length,
      },
      overallRisk,
      comments: deduped,
    };
  }

  async reviewCommit(repoPath: string, commitHash: string): Promise<ReviewReport> {
    let output: string;
    try {
      output = execSync(`git diff ${commitHash}^..${commitHash}`, {
        encoding: 'utf-8',
        cwd: repoPath,
        stdio: 'pipe',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository')) {
        throw new ReviewError(ReviewError.NOT_A_REPO, `Not a git repo: ${repoPath}`, { cause: err });
      }
      if (msg.includes('unknown revision') || msg.includes('bad revision')) {
        throw new ReviewError(ReviewError.INVALID_COMMIT, `Invalid commit: ${commitHash}`, { cause: err });
      }
      throw new ReviewError(ReviewError.DIFF_FAILED, `Failed to diff commit ${commitHash}: ${msg}`, { cause: err });
    }

    if (!output.trim()) {
      throw new ReviewError(ReviewError.NO_DIFF_DATA, `No diff data for commit ${commitHash}`);
    }

    const diff = parseDiffOutput(output);
    return this.reviewDiff(diff, repoPath);
  }

  async reviewPR(repoPath: string, baseBranch: string, headBranch: string): Promise<ReviewReport> {
    let output: string;
    try {
      output = execSync(`git diff ${baseBranch}..${headBranch}`, {
        encoding: 'utf-8',
        cwd: repoPath,
        stdio: 'pipe',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository')) {
        throw new ReviewError(ReviewError.NOT_A_REPO, `Not a git repo: ${repoPath}`, { cause: err });
      }
      throw new ReviewError(ReviewError.DIFF_FAILED, `Failed to diff ${baseBranch}..${headBranch}: ${msg}`, { cause: err });
    }

    if (!output.trim()) {
      throw new ReviewError(ReviewError.NO_DIFF_DATA, `No diff between ${baseBranch} and ${headBranch}`);
    }

    const diff = parseDiffOutput(output);
    return this.reviewDiff(diff, repoPath);
  }

  // ---- 分析器 ----

  private analyzeScope(files: DiffData['files'], stats: DiffData['stats']): ReviewComment[] {
    const comments: ReviewComment[] = [];
    const totalLines = stats.insertions + stats.deletions;

    if (files.length > 10 || totalLines > 500) {
      comments.push({
        dimension: 'scope',
        severity: 'warning',
        filePath: files[0]?.path ?? '',
        lineStart: 0,
        lineEnd: 0,
        title: '变更规模较大',
        message: `本次变更涉及 ${files.length} 个文件，共 ${totalLines} 行增删。建议拆分提交或 PR，以降低评审难度与回滚风险。`,
      });
    } else if (files.length > 5 || totalLines > 200) {
      comments.push({
        dimension: 'scope',
        severity: 'info',
        filePath: files[0]?.path ?? '',
        lineStart: 0,
        lineEnd: 0,
        title: '中等规模变更',
        message: `涉及 ${files.length} 个文件，${totalLines} 行增删。请确保变更聚焦于单一目标。`,
      });
    }

    // 混合文件类型提示
    const hasTests = files.some(f => /\.(test|spec)\./.test(f.path) || /__tests__/.test(f.path));
    const hasSource = files.some(f => isSourceFile(f.path) && !/\.(test|spec)\./.test(f.path));
    if (hasTests && hasSource) {
      comments.push({
        dimension: 'scope',
        severity: 'info',
        filePath: files[0]?.path ?? '',
        lineStart: 0,
        lineEnd: 0,
        title: '源码与测试同时变更',
        message: '源码与测试文件在同一批次变更，请确认测试覆盖了所有新增/修改逻辑。',
      });
    }

    return comments;
  }

  private analyzeRisk(files: DiffData['files']): ReviewComment[] {
    const comments: ReviewComment[] = [];

    for (const file of files) {
      if (isHighRiskFile(file.path)) {
        comments.push({
          dimension: 'risk',
          severity: 'critical',
          filePath: file.path,
          lineStart: 0,
          lineEnd: 0,
          title: '高风险文件变更',
          message: `「${file.path}」属于基础设施/配置类文件，变更可能影响构建、部署或全局行为，请仔细复核。`,
        });
      }

      if (file.changeType === 'deleted') {
        comments.push({
          dimension: 'risk',
          severity: 'warning',
          filePath: file.path,
          lineStart: 0,
          lineEnd: 0,
          title: '文件被删除',
          message: `文件「${file.path}」已被删除。请确认无其他文件仍引用该文件中的导出符号。`,
          suggestion: '运行未使用导出检测，验证是否存在残留引用。',
        });
      }

      if (file.changeType === 'renamed') {
        comments.push({
          dimension: 'risk',
          severity: 'warning',
          filePath: file.path,
          lineStart: 0,
          lineEnd: 0,
          title: '文件重命名',
          message: `文件「${file.path}」发生重命名。请同步更新所有 import / require 引用。`,
        });
      }
    }

    return comments;
  }

  private analyzeHunkStyle(filePath: string, hunk: DiffHunk): ReviewComment[] {
    const comments: ReviewComment[] = [];
    const isTSJS = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);

    for (const line of hunk.lines) {
      if (line.type !== 'added') continue;
      const content = line.content;
      const lineNum = line.newLine ?? hunk.newStart;

      // 行尾空格
      if (/\s+$/.test(content)) {
        comments.push({
          dimension: 'style',
          severity: 'info',
          filePath,
          lineStart: lineNum,
          lineEnd: lineNum,
          title: '行尾存在多余空格',
          message: '新增行末尾包含空白字符，建议清理。',
          suggestion: '配置编辑器保存时自动删除行尾空格（trim trailing whitespace）。',
        });
      }

      // 过长行
      if (content.length > 120) {
        comments.push({
          dimension: 'style',
          severity: 'info',
          filePath,
          lineStart: lineNum,
          lineEnd: lineNum,
          title: '行长度超过 120 字符',
          message: `当前行长度为 ${content.length} 字符，超出推荐上限，建议换行或提取变量。`,
        });
      }

      // console.log / debugger 残留
      if (isTSJS && /\bconsole\.(log|debug|warn|error|info)\(/.test(content)) {
        comments.push({
          dimension: 'style',
          severity: 'warning',
          filePath,
          lineStart: lineNum,
          lineEnd: lineNum,
          title: '包含调试日志语句',
          message: '新增代码包含 console.log / console.debug 等调试输出，合并前建议移除或替换为正式日志方案。',
        });
      }
      if (isTSJS && /\bdebugger;?\b/.test(content)) {
        comments.push({
          dimension: 'style',
          severity: 'critical',
          filePath,
          lineStart: lineNum,
          lineEnd: lineNum,
          title: '包含 debugger 语句',
          message: 'debugger 语句不应提交到主分支。',
        });
      }

      // TODO / FIXME / HACK 残留
      if (/(TODO|FIXME|HACK)[\s:]/i.test(content)) {
        comments.push({
          dimension: 'style',
          severity: 'info',
          filePath,
          lineStart: lineNum,
          lineEnd: lineNum,
          title: '包含临时注释标记',
          message: `发现「${content.match(/(TODO|FIXME|HACK)/i)?.[0] ?? ''}」标记，如非计划在本迭代解决，建议创建正式 issue 追踪。`,
        });
      }
    }

    return comments;
  }

  private analyzeHunkBugs(filePath: string, hunk: DiffHunk): ReviewComment[] {
    const comments: ReviewComment[] = [];
    const isTSJS = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);
    const isPy = /\.py$/.test(filePath);

    for (const line of hunk.lines) {
      if (line.type !== 'added') continue;
      const content = line.content;
      const lineNum = line.newLine ?? hunk.newStart;

      if (isTSJS) {
        // == 而非 ===
        if (/[^=!]==[^=]/.test(content) || /[^=!]!=[^=]/.test(content)) {
          comments.push({
            dimension: 'bug',
            severity: 'warning',
            filePath,
            lineStart: lineNum,
            lineEnd: lineNum,
            title: '使用松散相等运算符',
            message: '建议使用 === 和 !== 替代 == 和 !=，避免类型隐式转换带来的意外行为。',
            suggestion: '将 == 改为 ===，!= 改为 !==，并显式处理 null/undefined 情况。',
          });
        }

        // any 类型
        if (/\bany\b/.test(content)) {
          comments.push({
            dimension: 'bug',
            severity: 'info',
            filePath,
            lineStart: lineNum,
            lineEnd: lineNum,
            title: '使用 any 类型',
            message: 'TypeScript 中使用 any 会绕过类型检查，降低代码安全性。',
            suggestion: '尽可能使用具体类型或 unknown + 类型收窄替代 any。',
          });
        }

        // 空 catch
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(content) || /catch\s*\{\s*\}/.test(content)) {
          comments.push({
            dimension: 'bug',
            severity: 'warning',
            filePath,
            lineStart: lineNum,
            lineEnd: lineNum,
            title: '空的 catch 块',
            message: '捕获异常后未做任何处理，可能静默吞掉错误，导致问题难以排查。',
            suggestion: '至少记录日志或向上游抛出包装后的错误。',
          });
        }

        // 未 await 的 Promise（简单启发式）
        if (/\bawait\b/.test(content)) {
          // 如果包含 await 则检查是否是 await 了非 Promise
          // 这里不做复杂分析
        }
        if (/\bnew\s+Promise\(/.test(content) && !/\bawait\b/.test(content) && !/\.then\(/.test(content)) {
          comments.push({
            dimension: 'bug',
            severity: 'info',
            filePath,
            lineStart: lineNum,
            lineEnd: lineNum,
            title: 'Promise 可能未正确处理',
            message: '创建 Promise 后未看到 await 或 .then() 处理，请确认是否遗漏。',
          });
        }
      }

      if (isPy) {
        // 裸 except
        if (/except\s*:\s*$/.test(content)) {
          comments.push({
            dimension: 'bug',
            severity: 'warning',
            filePath,
            lineStart: lineNum,
            lineEnd: lineNum,
            title: '裸 except 子句',
            message: 'Python 中使用裸 except: 会捕获 KeyboardInterrupt 和 SystemExit，通常应指定具体异常类型。',
            suggestion: '使用 except Exception: 或更具体的异常类型。',
          });
        }
      }
    }

    return comments;
  }

  private deduplicate(comments: ReviewComment[]): ReviewComment[] {
    const seen = new Set<string>();
    return comments.filter(c => {
      const key = `${c.filePath}:${c.lineStart}:${c.lineEnd}:${c.dimension}:${c.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private computeOverallRisk(comments: ReviewComment[], stats: DiffData['stats']): 'low' | 'medium' | 'high' {
    const criticalCount = comments.filter(c => c.severity === 'critical').length;
    const warningCount = comments.filter(c => c.severity === 'warning').length;
    const totalLines = stats.insertions + stats.deletions;

    if (criticalCount > 0) return 'high';
    if (warningCount >= 3 || stats.filesChanged > 10 || totalLines > 500) return 'high';
    if (warningCount >= 1 || stats.filesChanged > 5 || totalLines > 200) return 'medium';
    return 'low';
  }

  private buildSummary(stats: DiffData['stats'], comments: ReviewComment[], risk: 'low' | 'medium' | 'high'): string {
    const scopeCount = comments.filter(c => c.dimension === 'scope').length;
    const riskCount = comments.filter(c => c.dimension === 'risk').length;
    const styleCount = comments.filter(c => c.dimension === 'style').length;
    const bugCount = comments.filter(c => c.dimension === 'bug').length;

    const riskText = risk === 'high' ? '高风险' : risk === 'medium' ? '中等风险' : '低风险';

    return `本次变更涉及 ${stats.filesChanged} 个文件，+${stats.insertions} / -${stats.deletions} 行。` +
      `评审发现 ${comments.length} 条意见（范围 ${scopeCount}、风险 ${riskCount}、风格 ${styleCount}、潜在问题 ${bugCount}）。` +
      `总体评估：${riskText}。`;
  }
}
