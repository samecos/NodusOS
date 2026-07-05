import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Convention } from '../common/types.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { AlignmentFlywheel, CorrectionCapture } from './alignment-flywheel.js';
import { classifyDiff } from './tag-classifier.js';
import type { ConventionsEmitter } from './conventions-emitter.js';

/**
 * 对齐飞轮实现
 */
export class AlignmentFlywheelImpl implements AlignmentFlywheel {
  constructor(
    private store: KnowledgeStore,
    private emitters: ConventionsEmitter[],
  ) {}

  capture(input: CorrectionCapture): void {
    const tags = classifyDiff(input.snapshot, input.after);

    this.store.codeAnnotationRecord({
      ai_generated_code: input.snapshot,
      human_modified_code: input.after,
      diff: this.computeSimpleDiff(input.snapshot, input.after),
      symbols_involved: JSON.stringify(input.symbols_involved),
      annotation_tags: JSON.stringify(tags),
      chunk_id: input.chunk_id,
      brief_field_hits: JSON.stringify(input.brief_field_hits),
      action: input.action,
      debt_at_review: input.debt_at_review,
      created_at: new Date().toISOString(),
    });

    // 累计约定
    for (const tag of tags) {
      const patternDesc = this.describeTag(tag);
      const symbolExample = input.symbols_involved[0] ?? null;
      this.store.conventionUpsert(tag, patternDesc, symbolExample);
      this.store.conventionIncrement(tag, symbolExample);
    }
  }

  emitConventions(projectRoot: string): void {
    const conventions = this.store.conventionList();
    for (const emitter of this.emitters) {
      try {
        const content = emitter.render(conventions);
        const fullPath = join(projectRoot, emitter.targetPath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, 'utf-8');
      } catch (err) {
        // 降级：仅更新本地表，不写文件
        console.error(`[AlignmentFlywheel] emit to ${emitter.targetPath} failed:`, err);
      }
    }
  }

  listConventions(): Convention[] {
    return this.store.conventionList();
  }

  prune(tag: string): boolean {
    return this.store.conventionDelete(tag);
  }

  private computeSimpleDiff(before: string, after: string): string {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    let diff = '';
    for (const line of beforeLines) diff += `- ${line}\n`;
    for (const line of afterLines) diff += `+ ${line}\n`;
    return diff;
  }

  private describeTag(tag: string): string {
    const descriptions: Record<string, string> = {
      add_null_check: '调用外部服务后未判空',
      add_error_handling: '缺少错误处理',
      add_type: '函数参数未标注类型',
      rename_symbol: '命名不规范',
      extract_function: '函数过大需拆分',
      remove_debug: '残留调试代码',
      simplify: '逻辑冗余需简化',
      revert: '变更被回滚',
    };
    return descriptions[tag] ?? tag;
  }
}
