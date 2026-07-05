// ============================================================
// 解析器插件系统 — LanguagePlugin 与 PluginRegistry
// ============================================================

import { extname } from 'node:path';
import type { Symbol, Reference, ImportBinding, ReexportInfo } from '../../common/types.js';
import type { CallEdge } from '../language-parser.js';

/** 单个文件的解析结果 */
export interface ParsedFile {
  symbols: Symbol[];
  references: Reference[];
  callEdges: CallEdge[];
  importBindings?: ImportBinding[];
  reexports?: ReexportInfo[];
}

/** 语言解析插件接口
 *
 * 每个 LanguagePlugin 对应一种编程语言的解析能力。
 * name 为插件唯一标识（如 'typescript'、'python'），
 * extensions 为支持的文件扩展名列表（如 ['.ts', '.tsx']），
 * parse 方法接收文件路径和源码内容，返回完整的解析结果。
 */
export interface LanguagePlugin {
  readonly name: string;
  readonly extensions: string[];
  parse(filePath: string, content: string): ParsedFile;
}

/** 插件注册表 — 管理语言解析插件的注册、注销与查找 */
export class PluginRegistry {
  private plugins: Map<string, LanguagePlugin> = new Map();
  private extToPlugin: Map<string, LanguagePlugin> = new Map();
  private aliases: Map<string, string> = new Map();

  /** 注册一个语言解析插件
   *
   * 插件按 name 唯一索引，extensions 用于文件路径到插件的映射。
   */
  register(plugin: LanguagePlugin): void {
    this.plugins.set(plugin.name, plugin);
    for (const ext of plugin.extensions) {
      this.extToPlugin.set(ext.toLowerCase(), plugin);
    }
  }

  /** 为已注册的插件注册别名
   *
   * 例如 `registerAlias('javascript', 'typescript')` 让 `.js` 文件
   * 在通过 `getPlugin('javascript')` 时也能命中 TypeScript 插件。
   */
  registerAlias(alias: string, pluginName: string): void {
    if (!this.plugins.has(pluginName)) {
      throw new Error(`Plugin "${pluginName}" 未注册，无法设置别名`);
    }
    this.aliases.set(alias, pluginName);
  }

  /** 注销插件（按名称或别名）
   *
   * 返回是否成功找到并移除了插件。
   */
  unregister(name: string): boolean {
    const plugin = this.getPlugin(name);
    if (!plugin) return false;

    // 删除插件本身
    this.plugins.delete(plugin.name);

    // 删除该插件相关的所有别名
    for (const [alias, target] of [...this.aliases]) {
      if (target === plugin.name) {
        this.aliases.delete(alias);
      }
    }

    // 删除扩展名映射
    for (const [ext, p] of [...this.extToPlugin]) {
      if (p === plugin) {
        this.extToPlugin.delete(ext);
      }
    }

    return true;
  }

  /** 按名称或别名获取插件 */
  getPlugin(name: string): LanguagePlugin | undefined {
    const plugin = this.plugins.get(name);
    if (plugin) return plugin;
    const aliasTarget = this.aliases.get(name);
    if (aliasTarget) return this.plugins.get(aliasTarget);
    return undefined;
  }

  /** 按文件路径获取对应的解析插件
   *
   * 根据文件扩展名查找，返回最匹配的 LanguagePlugin；
   * 若无匹配则返回 undefined。
   */
  getParserForFile(filePath: string): LanguagePlugin | undefined {
    const ext = extname(filePath).toLowerCase();
    return this.extToPlugin.get(ext);
  }

  /** 列出所有已注册的语言（含别名） */
  listSupportedLanguages(): string[] {
    return [...this.plugins.keys(), ...this.aliases.keys()];
  }
}
