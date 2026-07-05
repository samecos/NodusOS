import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ChangeBatch, ChangedSymbol } from '../common/types.js';
import type { ChangeSensor } from './change-sensor.js';
import type { GitIntelligence } from '../git-intel/git-intelligence.js';

/**
 * 默认变更传感器 — 通过 git diff 检测工作树变更
 */
export class DefaultChangeSensor implements ChangeSensor {
  private emitter = new EventEmitter();

  constructor(private gitIntel: GitIntelligence) {}

  start(_projectRoot: string): void {
    // P1: detect() 由 REPL 主动调用；start/stop 预留给 FileWatcher 集成
  }

  stop(): void {
    this.emitter.removeAllListeners();
  }

  onBatch(handler: (batch: ChangeBatch) => void): () => void {
    this.emitter.on('batch', handler);
    return () => this.emitter.off('batch', handler);
  }

  async detect(projectRoot: string): Promise<ChangeBatch | null> {
    const changedFiles = this.getChangedFiles(projectRoot);
    if (changedFiles.length === 0) return null;

    const symbols = this.extractChangedSymbols(projectRoot, changedFiles);
    const snapshot: Record<string, string> = {};
    for (const file of changedFiles) {
      const absPath = join(projectRoot, file);
      if (existsSync(absPath)) {
        snapshot[file] = readFileSync(absPath, 'utf-8');
      }
    }

    const batch: ChangeBatch = {
      id: `batch-${Date.now()}-${changedFiles.length}`,
      project_root: projectRoot,
      detected_at: new Date().toISOString(),
      files: changedFiles,
      symbols,
      snapshot,
    };

    this.emitter.emit('batch', batch);
    return batch;
  }

  /** 获取工作树相对于 HEAD 的变更文件列表 */
  private getChangedFiles(projectRoot: string): string[] {
    try {
      const output = execSync('git diff --name-only HEAD', {
        cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe',
      });
      const tracked = output.trim().split('\n').filter(Boolean);

      const untrackedOutput = execSync('git ls-files --others --exclude-standard', {
        cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe',
      });
      const untracked = untrackedOutput.trim().split('\n').filter(Boolean);

      return [...tracked, ...untracked];
    } catch {
      return [];
    }
  }

  /** 从 diff 中提取被改动的符号名（简化版：按行匹配 function/class 声明） */
  private extractChangedSymbols(projectRoot: string, files: string[]): ChangedSymbol[] {
    const symbols: ChangedSymbol[] = [];
    for (const file of files) {
      const absPath = join(projectRoot, file);
      if (!existsSync(absPath)) continue;
      const content = readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 简化匹配：TS/JS function/class 声明
        const match = line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let)\s+(\w+)/);
        if (match) {
          symbols.push({
            symbol_id: `${file}:${match[1]}`,
            name: match[1],
            file_path: file,
            line_start: i + 1,
            line_end: i + 1,
            diff_text: line,
          });
        }
      }
    }
    return symbols;
  }
}
