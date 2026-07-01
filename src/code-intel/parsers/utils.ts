import { createHash } from 'node:crypto';
import type { SymbolKind } from '../../common/types.js';

/** 计算符号 ID = SHA256(path + name + kind + line) 的前 16 字符 */
export function hashSymbolId(
  filePath: string,
  name: string,
  kind: SymbolKind | string,
  line: number,
): string {
  const input = `${filePath}:${name}:${kind}:${line}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
