import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { ImportBinding, Reference, SymbolId } from '../common/types.js';
import type { ModuleResolver } from './module-resolver.js';

/** 把引用中的 external:/unknown: 目标解析为 KnowledgeStore 中的真实符号 ID */
export class ReferenceResolver {
  constructor(
    private moduleResolver: ModuleResolver,
    private store: KnowledgeStore,
  ) {}

  resolveFileRefs(filePath: string, refs: Reference[], bindings: ImportBinding[]): void {
    const bindingByLocal = new Map(bindings.map(b => [b.localName, b]));

    for (const ref of refs) {
      if (!this.isUnresolved(ref.target_symbol_id)) continue;

      const raw = ref.target_symbol_id.split(':')[1] ?? '';

      if (ref.kind === 'import') {
        // import 引用的目标名是原始导出名
        const binding = bindings.find(b => b.importedName === raw);
        if (binding) {
          const resolved = this.resolveBinding(binding, filePath);
          if (resolved) ref.target_symbol_id = resolved;
        }
        continue;
      }

      // call / type_use / instantiation / decorator_use
      if (raw.includes('.')) {
        // namespace 调用：由 parser 生成 external:alias.method
        const [alias, ...rest] = raw.split('.');
        const method = rest.join('.');
        const binding = bindings.find(b => b.kind === 'namespace' && b.localName === alias);
        if (binding) {
          const resolved = this.resolveSymbolInModule(binding.source, method, filePath);
          if (resolved) ref.target_symbol_id = resolved;
        }
        continue;
      }

      const binding = bindingByLocal.get(raw);
      if (binding) {
        const resolved = this.resolveBinding(binding, filePath);
        if (resolved) ref.target_symbol_id = resolved;
      }
    }
  }

  private isUnresolved(target: SymbolId): boolean {
    return target.startsWith('external:') || target.startsWith('unknown:');
  }

  private resolveBinding(binding: ImportBinding, fromFile: string): SymbolId | undefined {
    if (binding.kind === 'namespace') return undefined;

    const resolvedFile = this.moduleResolver.resolve(binding.source, fromFile);
    if (!resolvedFile) return undefined;

    if (binding.kind === 'default') {
      return this.resolveDefaultExport(resolvedFile, binding.localName);
    }

    return this.resolveSymbolInFile(resolvedFile, binding.importedName);
  }

  private resolveSymbolInModule(source: string, name: string, fromFile: string): SymbolId | undefined {
    const resolvedFile = this.moduleResolver.resolve(source, fromFile);
    if (!resolvedFile) return undefined;
    return this.resolveSymbolInFile(resolvedFile, name);
  }

  private resolveSymbolInFile(filePath: string, name: string): SymbolId | undefined {
    const syms = this.store.symbolsFindByFile(filePath).filter(s => s.is_exported && s.name === name);
    if (syms.length > 0) return syms[0].id;
    return this.resolveReexport(name, filePath);
  }

  private resolveDefaultExport(filePath: string, localName: string): SymbolId | undefined {
    const exported = this.store.symbolsFindByFile(filePath).filter(s => s.is_exported);
    if (exported.length === 0) return undefined;
    // 优先找与导入别名同名的导出；否则取第一个导出符号
    return exported.find(s => s.name === localName)?.id ?? exported[0].id;
  }

  private resolveReexport(name: string, filePath: string): SymbolId | undefined {
    // 本 task 先留 stub，Task 5 实现递归 re-export 解析
    return undefined;
  }
}
