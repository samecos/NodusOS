import type { Convention } from '../../common/types.js';
import type { ConventionsEmitter } from '../conventions-emitter.js';

/**
 * .nodus/conventions.md 发射器 — 默认约定文件格式
 */
export class NodusMdEmitter implements ConventionsEmitter {
  readonly name = 'nodus-md';
  readonly targetPath = '.nodus/conventions.md';

  render(conventions: Convention[]): string {
    if (conventions.length === 0) {
      return '# 项目约定（由 NodusOS 从人工修正中提炼）\n\n暂无已记录的模式。\n';
    }

    let out = '# 项目约定（由 NodusOS 从人工修正中提炼）\n\n';
    out += '## 已知需人工修正的模式\n\n';
    for (const conv of conventions) {
      out += `- **${conv.tag}**: "${conv.pattern_desc}" 出现 ${conv.occurrences} 次\n`;
      if (conv.symbol_examples) {
        out += `  示例符号: ${conv.symbol_examples}\n`;
      }
    }
    out += '\n<!-- 由 NodusOS 自动生成，可通过 /prune 删除过时项 -->\n';
    return out;
  }
}
