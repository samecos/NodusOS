import type { Convention } from '../common/types.js';

/**
 * 约定发射器 — 把修正模式写入文件反喂 AI 工具
 */
export interface ConventionsEmitter {
  /** 发射器名称 */
  readonly name: string;
  /** 目标文件路径（相对项目根） */
  readonly targetPath: string;
  /** 将约定列表渲染为文件内容 */
  render(conventions: Convention[]): string;
}
