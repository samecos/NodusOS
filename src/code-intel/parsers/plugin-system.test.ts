// ============================================================
// 解析器插件系统测试
// TC-UT-PS-001 ~ TC-UT-PS-015
// ============================================================

import { describe, it, expect } from 'vitest';
import { PluginRegistry, LanguagePlugin } from './plugin-system.js';
import { TypeScriptParser } from './typescript-parser.js';
import { PythonParser } from './python-parser.js';

// TC-UT-PS-001: 注册插件
it('TC-UT-PS-001: should register a language plugin', () => {
  const registry = new PluginRegistry();
  const plugin: LanguagePlugin = {
    name: 'testlang',
    extensions: ['.test'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  registry.register(plugin);
  expect(registry.listSupportedLanguages()).toContain('testlang');
});

// TC-UT-PS-002: 按文件路径获取解析器
it('TC-UT-PS-002: should get parser for file by extension', () => {
  const registry = new PluginRegistry();
  const plugin: LanguagePlugin = {
    name: 'testlang',
    extensions: ['.test'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  registry.register(plugin);
  expect(registry.getParserForFile('src/foo.test')).toBe(plugin);
  expect(registry.getParserForFile('src/foo.txt')).toBeUndefined();
});

// TC-UT-PS-003: 注销插件
it('TC-UT-PS-003: should unregister a plugin', () => {
  const registry = new PluginRegistry();
  const plugin: LanguagePlugin = {
    name: 'testlang',
    extensions: ['.test'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  registry.register(plugin);
  expect(registry.unregister('testlang')).toBe(true);
  expect(registry.listSupportedLanguages()).toHaveLength(0);
  expect(registry.getParserForFile('src/foo.test')).toBeUndefined();
});

// TC-UT-PS-004: 注册别名
it('TC-UT-PS-004: should register alias for a plugin', () => {
  const registry = new PluginRegistry();
  const plugin: LanguagePlugin = {
    name: 'typescript',
    extensions: ['.ts', '.js'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  registry.register(plugin);
  registry.registerAlias('javascript', 'typescript');
  expect(registry.listSupportedLanguages()).toContain('javascript');
  expect(registry.getPlugin('javascript')).toBe(plugin);
});

// TC-UT-PS-005: 按别名获取插件
it('TC-UT-PS-005: should get plugin by alias', () => {
  const registry = new PluginRegistry();
  const plugin: LanguagePlugin = {
    name: 'typescript',
    extensions: ['.ts', '.js'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  registry.register(plugin);
  registry.registerAlias('javascript', 'typescript');
  expect(registry.getPlugin('javascript')).toBe(plugin);
  expect(registry.getParserForFile('src/foo.js')).toBe(plugin);
});

// TC-UT-PS-006: 注销插件同时删除别名
it('TC-UT-PS-006: should remove aliases when unregistering plugin', () => {
  const registry = new PluginRegistry();
  const plugin: LanguagePlugin = {
    name: 'typescript',
    extensions: ['.ts', '.js'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  registry.register(plugin);
  registry.registerAlias('javascript', 'typescript');
  registry.unregister('typescript');
  expect(registry.getPlugin('javascript')).toBeUndefined();
  expect(registry.getParserForFile('src/foo.js')).toBeUndefined();
});

// TC-UT-PS-007: 列出所有支持的语言
it('TC-UT-PS-007: should list all supported languages including aliases', () => {
  const registry = new PluginRegistry();
  registry.register({
    name: 'typescript',
    extensions: ['.ts'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  });
  registry.register({
    name: 'python',
    extensions: ['.py'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  });
  registry.registerAlias('javascript', 'typescript');
  const languages = registry.listSupportedLanguages();
  expect(languages).toContain('typescript');
  expect(languages).toContain('python');
  expect(languages).toContain('javascript');
});

// TC-UT-PS-008: 多个扩展名映射到同一个插件
it('TC-UT-PS-008: should map multiple extensions to the same plugin', () => {
  const registry = new PluginRegistry();
  const plugin: LanguagePlugin = {
    name: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  registry.register(plugin);
  expect(registry.getParserForFile('src/foo.ts')).toBe(plugin);
  expect(registry.getParserForFile('src/foo.tsx')).toBe(plugin);
  expect(registry.getParserForFile('src/foo.js')).toBe(plugin);
  expect(registry.getParserForFile('src/foo.jsx')).toBe(plugin);
});

// TC-UT-PS-009: TypeScriptParser 作为 LanguagePlugin
it('TC-UT-PS-009: TypeScriptParser should implement LanguagePlugin', () => {
  const parser = new TypeScriptParser();
  expect(parser.name).toBe('typescript');
  expect(parser.extensions).toContain('.ts');
  expect(parser.extensions).toContain('.js');
});

// TC-UT-PS-010: TypeScriptParser parse 方法
it('TC-UT-PS-010: TypeScriptParser.parse should return ParsedFile', () => {
  const parser = new TypeScriptParser();
  const source = 'export function foo(): void {}';
  const parsed = parser.parse('src/test.ts', source);
  expect(parsed.symbols).toBeDefined();
  expect(parsed.references).toBeDefined();
  expect(parsed.callEdges).toBeDefined();
  expect(parsed.importBindings).toBeDefined();
  expect(parsed.reexports).toBeDefined();
});

// TC-UT-PS-011: PythonParser 作为 LanguagePlugin
it('TC-UT-PS-011: PythonParser should implement LanguagePlugin', () => {
  const parser = new PythonParser();
  expect(parser.name).toBe('python');
  expect(parser.extensions).toContain('.py');
});

// TC-UT-PS-012: PythonParser parse 方法
it('TC-UT-PS-012: PythonParser.parse should return ParsedFile', () => {
  const parser = new PythonParser();
  const source = 'def foo(): pass';
  const parsed = parser.parse('src/test.py', source);
  expect(parsed.symbols).toBeDefined();
  expect(parsed.references).toBeDefined();
  expect(parsed.callEdges).toBeDefined();
});

// TC-UT-PS-013: PluginRegistry 注册 TypeScript 和 Python 插件
it('TC-UT-PS-013: should register TypeScript and Python plugins in registry', () => {
  const registry = new PluginRegistry();
  const tsParser = new TypeScriptParser();
  const pyParser = new PythonParser();
  registry.register(tsParser);
  registry.registerAlias('javascript', 'typescript');
  registry.register(pyParser);

  expect(registry.getPlugin('typescript')).toBe(tsParser);
  expect(registry.getPlugin('javascript')).toBe(tsParser);
  expect(registry.getPlugin('python')).toBe(pyParser);
  expect(registry.getParserForFile('src/test.ts')).toBe(tsParser);
  expect(registry.getParserForFile('src/test.js')).toBe(tsParser);
  expect(registry.getParserForFile('src/test.py')).toBe(pyParser);
});

// TC-UT-PS-014: 注销不存在的插件返回 false
it('TC-UT-PS-014: unregistering non-existent plugin returns false', () => {
  const registry = new PluginRegistry();
  expect(registry.unregister('nonexistent')).toBe(false);
});

// TC-UT-PS-015: 注册别名到不存在的插件抛出错误
it('TC-UT-PS-015: registering alias for non-existent plugin throws', () => {
  const registry = new PluginRegistry();
  expect(() => registry.registerAlias('js', 'typescript')).toThrow('未注册');
});

// TC-UT-PS-016: TypeScriptParser.parse 返回正确的符号和引用
it('TC-UT-PS-016: TypeScriptParser.parse should return correct symbols and references', () => {
  const parser = new TypeScriptParser();
  const source = `
export function refundOrder(orderId: string): void {}
refundOrder(100);
`;
  const parsed = parser.parse('src/payment.ts', source);

  expect(parsed.symbols.length).toBeGreaterThanOrEqual(1);
  const fn = parsed.symbols.find(s => s.name === 'refundOrder');
  expect(fn).toBeDefined();
  expect(fn!.kind).toBe('function');

  // 引用应包含对 refundOrder 的调用
  const callRefs = parsed.references.filter(r => r.kind === 'call');
  expect(callRefs.length).toBeGreaterThanOrEqual(1);
});

// TC-UT-PS-017: PythonParser.parse 返回正确的符号和引用
it('TC-UT-PS-017: PythonParser.parse should return correct symbols and references', () => {
  const parser = new PythonParser();
  const source = `
def refund_order(amount):
    return process_payment(amount)

refund_order(100)
`;
  const parsed = parser.parse('src/payment.py', source);

  expect(parsed.symbols.length).toBeGreaterThanOrEqual(1);
  const fn = parsed.symbols.find(s => s.name === 'refund_order');
  expect(fn).toBeDefined();
  expect(fn!.kind).toBe('function');

  const callRefs = parsed.references.filter(r => r.kind === 'call');
  expect(callRefs.length).toBeGreaterThanOrEqual(1);
});

// TC-UT-PS-018: 扩展名大小写不敏感
it('TC-UT-PS-018: should match extensions case-insensitively', () => {
  const registry = new PluginRegistry();
  const plugin: LanguagePlugin = {
    name: 'testlang',
    extensions: ['.TEST'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  registry.register(plugin);
  expect(registry.getParserForFile('src/foo.test')).toBe(plugin);
  expect(registry.getParserForFile('src/foo.TEST')).toBe(plugin);
});

// TC-UT-PS-019: 覆盖扩展名映射
it('TC-UT-PS-019: later registered plugin should override earlier extension mapping', () => {
  const registry = new PluginRegistry();
  const pluginA: LanguagePlugin = {
    name: 'langA',
    extensions: ['.txt'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  const pluginB: LanguagePlugin = {
    name: 'langB',
    extensions: ['.txt'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  registry.register(pluginA);
  registry.register(pluginB);
  expect(registry.getParserForFile('src/foo.txt')).toBe(pluginB);
});

// TC-UT-PS-020: 注销后重新注册
it('TC-UT-PS-020: should re-register plugin after unregister', () => {
  const registry = new PluginRegistry();
  const plugin: LanguagePlugin = {
    name: 'testlang',
    extensions: ['.test'],
    parse: () => ({ symbols: [], references: [], callEdges: [] }),
  };
  registry.register(plugin);
  registry.unregister('testlang');
  expect(registry.getParserForFile('src/foo.test')).toBeUndefined();
  registry.register(plugin);
  expect(registry.getParserForFile('src/foo.test')).toBe(plugin);
});
