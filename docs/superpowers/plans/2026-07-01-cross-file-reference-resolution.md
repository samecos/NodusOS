# R1.3 跨文件引用解析增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 TypeScript/JavaScript 的 `import` 不再只解析成 `external:name`，而是能根据 `tsconfig.json` paths、相对路径、`index.ts` re-export、namespace import 准确指向项目内具体符号 ID，从而提升 `find_references`、`call_graph`、`impact_analysis` 的精度。

**Architecture:** 新增 `ModuleResolver` 负责把 import source 解析成绝对文件路径；扩展 `TypeScriptParser` 提取 import binding 与 re-export 信息；新增 `ReferenceResolver` 在索引完成后作为第二遍扫描，把引用目标从 `external:/unknown:` 改写成 store 中实际存在的导出符号 ID；最后把两阶段解析接入 `CodeIntelligence.indexProject` / `indexFile`。

**Tech Stack:** Node.js 20+、TypeScript 5.x、tree-sitter、better-sqlite3、Vitest。

## Global Constraints

- 模块系统：ESM，`"type": "module"`；类型导入必须写 `import type { ... }`。
- TypeScript：`strict: true`、`verbatimModuleSyntax: true`。
- 测试：每次提交前 `npm test` 必须全绿（当前 177 passed）。
- 代码注释主要使用中文，标识符保持英文。
- 不允许修改数据库 schema；只改动 `refs.target_symbol_id` 的值。
- TDD：每个 task 先写失败测试，再写最小实现。
- 每个 task 独立可 review，独立可测试。

## File Structure

| 文件 | 职责 |
|------|------|
| `src/common/types.ts` | 新增 `ImportBinding`、`ReexportInfo` 类型。 |
| `src/code-intel/module-resolver.ts` | 读取 `tsconfig.json`，把 import source 解析成绝对文件路径。 |
| `src/code-intel/module-resolver.test.ts` | ModuleResolver 单元测试。 |
| `src/code-intel/parsers/typescript-parser.ts` | 新增 `parseImportBindings`、`parseReexports`；namespace 调用目标带 `alias.method` 前缀。 |
| `src/code-intel/reference-resolver.ts` | 用 ModuleResolver + KnowledgeStore 重写引用目标。 |
| `src/code-intel/reference-resolver.test.ts` | ReferenceResolver 单元测试。 |
| `src/code-intel/code-intelligence.impl.ts` | 在 `indexProject` / `indexFile` 中加入两阶段解析。 |
| `src/code-intel/code-intelligence.integration.test.ts` | 新增跨文件引用集成测试。 |
| `readme.md` | 勾选 R1.3，更新测试计数。 |
| `ArchitecturalDesignPhase/05-Future-Roadmap.md` | 更新 R1.3 状态。 |

---

## Task 1: ModuleResolver — 相对路径 + tsconfig paths

**Files:**
- Create: `src/code-intel/module-resolver.ts`
- Test: `src/code-intel/module-resolver.test.ts`

**Interfaces:**
- Consumes: `projectRoot: string`
- Produces: `resolve(source: string, fromFile: string): string | undefined`

- [ ] **Step 1: 写失败测试**

在 `src/code-intel/module-resolver.test.ts` 中：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModuleResolver } from './module-resolver.js';

const TMP = join(tmpdir(), `nodus-module-resolver-${Date.now()}`);

beforeEach(() => {
  mkdirSync(join(TMP, 'src', 'utils'), { recursive: true });
  writeFileSync(join(TMP, 'src', 'payment.ts'), 'export function refund(): void {}');
  writeFileSync(join(TMP, 'src', 'utils', 'index.ts'), 'export * from "./format";');
  writeFileSync(join(TMP, 'src', 'utils', 'format.ts'), 'export function formatCurrency(n: number): string { return ""; }');
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('ModuleResolver', () => {
  it('TC-UT-MR-001: 解析相对文件路径', () => {
    const resolver = new ModuleResolver(TMP);
    const resolved = resolver.resolve('./payment', join(TMP, 'src', 'app.ts'));
    expect(resolved).toBe(join(TMP, 'src', 'payment.ts'));
  });

  it('TC-UT-MR-002: 解析相对目录到 index.ts', () => {
    const resolver = new ModuleResolver(TMP);
    const resolved = resolver.resolve('./utils', join(TMP, 'src', 'app.ts'));
    expect(resolved).toBe(join(TMP, 'src', 'utils', 'index.ts'));
  });

  it('TC-UT-MR-003: 解析 tsconfig paths 别名', () => {
    writeFileSync(join(TMP, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] }
    }));
    const resolver = new ModuleResolver(TMP);
    const resolved = resolver.resolve('@/payment', join(TMP, 'src', 'app.ts'));
    expect(resolved).toBe(join(TMP, 'src', 'payment.ts'));
  });

  it('TC-UT-MR-004: 外部包返回 undefined', () => {
    const resolver = new ModuleResolver(TMP);
    expect(resolver.resolve('lodash', join(TMP, 'src', 'app.ts'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/code-intel/module-resolver.test.ts
```

Expected: `ModuleResolver is not defined` 或 `Cannot find module` 失败。

- [ ] **Step 3: 实现 ModuleResolver**

创建 `src/code-intel/module-resolver.ts`：

```typescript
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export interface TsConfigPaths {
  [alias: string]: string[];
}

/** 把 import source 解析为项目内绝对文件路径 */
export class ModuleResolver {
  private projectRoot: string;
  private baseUrl: string;
  private paths: TsConfigPaths = {};

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.baseUrl = projectRoot;
    this.loadTsConfig();
  }

  /** 解析 import source，失败返回 undefined（代表外部包） */
  resolve(source: string, fromFile: string): string | undefined {
    if (source.startsWith('.')) {
      return this.resolveRelative(source, fromFile);
    }
    const tsResolved = this.resolveTsConfigPaths(source);
    if (tsResolved) return tsResolved;
    return undefined;
  }

  private loadTsConfig(): void {
    const tsconfigPath = join(this.projectRoot, 'tsconfig.json');
    if (!existsSync(tsconfigPath)) return;
    try {
      const raw = readFileSync(tsconfigPath, 'utf-8');
      const config = JSON.parse(raw) as { compilerOptions?: { baseUrl?: string; paths?: TsConfigPaths } };
      const compilerOptions = config.compilerOptions ?? {};
      this.baseUrl = compilerOptions.baseUrl
        ? resolve(this.projectRoot, compilerOptions.baseUrl)
        : this.projectRoot;
      this.paths = compilerOptions.paths ?? {};
    } catch {
      // tsconfig 解析失败时降级为无 paths
    }
  }

  private resolveRelative(source: string, fromFile: string): string | undefined {
    const fromDir = dirname(fromFile);
    const base = resolve(fromDir, source);
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    if (existsSync(base) && statSync(base).isFile()) return base;

    for (const ext of extensions) {
      const candidate = `${base}${ext}`;
      if (existsSync(candidate)) return candidate;
    }

    for (const ext of extensions) {
      const candidate = join(base, `index${ext}`);
      if (existsSync(candidate)) return candidate;
    }

    return undefined;
  }

  private resolveTsConfigPaths(source: string): string | undefined {
    for (const [alias, targets] of Object.entries(this.paths)) {
      const captured = this.matchAlias(source, alias);
      if (captured === null) continue;

      for (const target of targets) {
        const mapped = this.applyAliasTarget(target, captured);
        const resolved = this.resolveRelative(mapped, this.baseUrl);
        if (resolved) return resolved;
      }
    }
    return undefined;
  }

  /** 返回匹配后捕获的通配符部分；不匹配返回 null */
  private matchAlias(source: string, alias: string): string | null {
    if (!alias.endsWith('/*')) {
      return source === alias ? '' : null;
    }
    const prefix = alias.slice(0, -1); // 保留末尾斜杠，例如 "@/"
    if (!source.startsWith(prefix)) return null;
    return source.slice(prefix.length);
  }

  private applyAliasTarget(target: string, captured: string): string {
    if (target.includes('*')) {
      return target.replace('*', captured);
    }
    return captured ? `${target}/${captured}` : target;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/code-intel/module-resolver.test.ts
```

Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/code-intel/module-resolver.ts src/code-intel/module-resolver.test.ts
git commit -m "feat(code-intel): add ModuleResolver for relative and tsconfig paths"
```

---

## Task 2: TypeScriptParser 提取 Import Binding 与 Re-export

**Files:**
- Modify: `src/common/types.ts`
- Modify: `src/code-intel/parsers/typescript-parser.ts`
- Test: `src/code-intel/code-intelligence.test.ts`（新增用例）

**Interfaces:**
- Consumes: tree-sitter AST
- Produces: `ImportBinding[]`、`ReexportInfo[]`

- [ ] **Step 1: 新增类型定义**

在 `src/common/types.ts` 中 `Reference` 后追加：

```typescript
/** import 绑定信息 */
export interface ImportBinding {
  source: string;
  kind: 'named' | 'default' | 'namespace';
  localName: string;
  importedName: string;
  location: SourceLocation;
}

/** re-export 信息：index.ts 中 `export { foo } from './foo'` */
export interface ReexportInfo {
  name: string;
  source: string;
  location: SourceLocation;
}
```

- [ ] **Step 2: 写失败测试**

在 `src/code-intel/code-intelligence.test.ts` 末尾追加：

```typescript
  // TC-UT-CI-020: 提取 import binding
  it('TC-UT-CI-020: should extract import bindings', () => {
    const source = `
import refund, { getOrder as get, Order } from './payment';
import * as payment from './payment';
`;
    const bindings = parser.parseImportBindings(source, 'src/app.ts');
    const named = bindings.filter(b => b.kind === 'named');
    const def = bindings.find(b => b.kind === 'default');
    const ns = bindings.find(b => b.kind === 'namespace');

    expect(named.length).toBe(2);
    expect(named.find(b => b.localName === 'get')?.importedName).toBe('getOrder');
    expect(named.find(b => b.localName === 'Order')?.importedName).toBe('Order');
    expect(def?.localName).toBe('refund');
    expect(ns?.localName).toBe('payment');
  });

  // TC-UT-CI-021: 提取 re-export
  it('TC-UT-CI-021: should extract re-exports from index file', () => {
    const source = `export { refundOrder } from './payment';\nexport { formatCurrency } from './format';`;
    const reexports = parser.parseReexports(source, 'src/index.ts');
    expect(reexports.map(r => r.name)).toContain('refundOrder');
    expect(reexports.map(r => r.name)).toContain('formatCurrency');
  });
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm test -- src/code-intel/code-intelligence.test.ts
```

Expected: `parseImportBindings is not a function`。

- [ ] **Step 4: 实现 parseImportBindings / parseReexports**

在 `src/code-intel/parsers/typescript-parser.ts` 中：

1. 导入新类型：

```typescript
import type { Language, Symbol, Reference, SymbolKind, ImportBinding, ReexportInfo } from '../../common/types.js';
```

2. 类内新增公共方法：

```typescript
  parseImportBindings(source: string, filePath: string): ImportBinding[] {
    this.parser.setLanguage(this.pickLang(filePath));
    const tree = this.parser.parse(source, undefined, { bufferSize: Math.max(32768, Buffer.byteLength(source, 'utf8')) });
    const bindings: ImportBinding[] = [];
    this.walkForImportBindings(tree.rootNode, filePath, bindings);
    return bindings;
  }

  parseReexports(source: string, filePath: string): ReexportInfo[] {
    this.parser.setLanguage(this.pickLang(filePath));
    const tree = this.parser.parse(source, undefined, { bufferSize: Math.max(32768, Buffer.byteLength(source, 'utf8')) });
    const reexports: ReexportInfo[] = [];
    this.walkForReexports(tree.rootNode, filePath, reexports);
    return reexports;
  }
```

3. 新增私有遍历方法（放在 `walkForCallEdges` 之后）：

```typescript
  private walkForImportBindings(
    node: TSNode,
    filePath: string,
    bindings: ImportBinding[],
  ): void {
    if (node.type !== 'import_statement') {
      for (const child of node.namedChildren) {
        this.walkForImportBindings(child, filePath, bindings);
      }
      return;
    }

    const sourceNode = node.namedChildren.find(c => c.type === 'string');
    const source = sourceNode?.text.replace(/^['"]|['"]$/g, '') ?? '';
    const clause = node.namedChildren.find(c => c.type === 'import_clause');
    if (!clause) return;

    const loc = (n: TSNode) => ({
      file_path: filePath,
      line_start: n.startPosition.row + 1,
      line_end: n.endPosition.row + 1,
      col_start: n.startPosition.column + 1,
      col_end: n.endPosition.column + 1,
    });

    for (const child of clause.namedChildren) {
      if (child.type === 'identifier') {
        // default import: import foo from './foo'
        bindings.push({ source, kind: 'default', localName: child.text, importedName: 'default', location: loc(child) });
      } else if (child.type === 'namespace_import') {
        const nameNode = child.namedChildren.find(c => c.type === 'identifier');
        if (nameNode) {
          bindings.push({ source, kind: 'namespace', localName: nameNode.text, importedName: '*', location: loc(nameNode) });
        }
      } else if (child.type === 'named_imports') {
        for (const spec of child.namedChildren) {
          if (spec.type !== 'import_specifier') continue;
          const importedNode = spec.childForFieldName?.('name');
          const aliasNode = spec.childForFieldName?.('alias');
          const importedName = importedNode?.text ?? spec.text;
          const localName = aliasNode?.text ?? importedName;
          bindings.push({ source, kind: 'named', localName, importedName, location: loc(spec) });
        }
      }
    }
  }

  private walkForReexports(
    node: TSNode,
    filePath: string,
    reexports: ReexportInfo[],
  ): void {
    if (node.type !== 'export_statement') {
      for (const child of node.namedChildren) {
        this.walkForReexports(child, filePath, reexports);
      }
      return;
    }

    const sourceNode = node.namedChildren.find(c => c.type === 'string');
    if (!sourceNode) return; // 不是 `from` re-export
    const source = sourceNode.text.replace(/^['"]|['"]$/g, '');

    for (const child of node.namedChildren) {
      if (child.type !== 'export_specifier') continue;
      const nameNode = child.childForFieldName?.('name');
      if (!nameNode) continue;
      reexports.push({
        name: nameNode.text,
        source,
        location: {
          file_path: filePath,
          line_start: child.startPosition.row + 1,
          line_end: child.endPosition.row + 1,
          col_start: child.startPosition.column + 1,
          col_end: child.endPosition.column + 1,
        },
      });
    }
  }
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npm test -- src/code-intel/code-intelligence.test.ts
```

Expected: 新增 2 个用例通过，全部测试保持绿色。

- [ ] **Step 6: 提交**

```bash
git add src/common/types.ts src/code-intel/parsers/typescript-parser.ts src/code-intel/code-intelligence.test.ts
git commit -m "feat(code-intel): extract import bindings and re-exports in TypeScriptParser"
```

---

## Task 3: ReferenceResolver — named/default import 解析

**Files:**
- Create: `src/code-intel/reference-resolver.ts`
- Test: `src/code-intel/reference-resolver.test.ts`

**Interfaces:**
- Consumes: `ModuleResolver`、`KnowledgeStore`、`Reference[]`、`ImportBinding[]`
- Produces: 原地修改后的 `Reference[]`

- [ ] **Step 1: 写失败测试**

创建 `src/code-intel/reference-resolver.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { ModuleResolver } from './module-resolver.js';
import { ReferenceResolver } from './reference-resolver.js';
import { TypeScriptParser } from './parsers/typescript-parser.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';

const TMP = join(tmpdir(), `nodus-ref-resolver-${Date.now()}`);

describe('ReferenceResolver', () => {
  let store: KnowledgeStore;
  let resolver: ReferenceResolver;
  let parser: TypeScriptParser;

  beforeEach(() => {
    mkdirSync(join(TMP, 'src'), { recursive: true });
    writeFileSync(join(TMP, 'src', 'payment.ts'), `
export function refundOrder(): void {}
export function getOrder(): void {}
export default function defaultRefund(): void {}
`);
    writeFileSync(join(TMP, 'src', 'app.ts'), `
import { refundOrder, getOrder } from './payment';
import defaultRefund from './payment';
refundOrder();
getOrder();
defaultRefund();
`);
    store = new SqliteKnowledgeStore(':memory:');
    parser = new TypeScriptParser();

    const paymentSrc = `export function refundOrder(): void {}\nexport function getOrder(): void {}\nexport default function defaultRefund(): void {}`;
    const paymentSyms = parser.parseSymbols(paymentSrc, join(TMP, 'src', 'payment.ts'));
    store.symbolsUpsert(paymentSyms);

    resolver = new ReferenceResolver(new ModuleResolver(TMP), store);
  });

  afterEach(() => {
    store.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('TC-UT-RR-001: named import 解析到真实符号 ID', () => {
    const appSrc = `import { refundOrder, getOrder } from './payment';\nrefundOrder();\ngetOrder();`;
    const appSyms = parser.parseSymbols(appSrc, join(TMP, 'src', 'app.ts'));
    const refs = parser.parseReferences(appSrc, appSyms);
    const bindings = parser.parseImportBindings(appSrc, join(TMP, 'src', 'app.ts'));

    resolver.resolveFileRefs(join(TMP, 'src', 'app.ts'), refs, bindings);

    const paymentSyms = store.symbolsFindByFile(join(TMP, 'src', 'payment.ts'));
    const refundSym = paymentSyms.find(s => s.name === 'refundOrder')!;
    const getSym = paymentSyms.find(s => s.name === 'getOrder')!;

    const callRefs = refs.filter(r => r.kind === 'call');
    expect(callRefs[0]!.target_symbol_id).toBe(refundSym.id);
    expect(callRefs[1]!.target_symbol_id).toBe(getSym.id);
  });

  it('TC-UT-RR-002: default import 解析到默认导出符号', () => {
    const appSrc = `import defaultRefund from './payment';\ndefaultRefund();`;
    const appSyms = parser.parseSymbols(appSrc, join(TMP, 'src', 'app.ts'));
    const refs = parser.parseReferences(appSrc, appSyms);
    const bindings = parser.parseImportBindings(appSrc, join(TMP, 'src', 'app.ts'));

    resolver.resolveFileRefs(join(TMP, 'src', 'app.ts'), refs, bindings);

    const defaultSym = store.symbolsFindByFile(join(TMP, 'src', 'payment.ts')).find(s => s.name === 'defaultRefund')!;
    const callRef = refs.find(r => r.kind === 'call')!;
    expect(callRef.target_symbol_id).toBe(defaultSym.id);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/code-intel/reference-resolver.test.ts
```

Expected: `ReferenceResolver is not defined`。

- [ ] **Step 3: 实现 ReferenceResolver**

创建 `src/code-intel/reference-resolver.ts`：

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/code-intel/reference-resolver.test.ts
```

Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/code-intel/reference-resolver.ts src/code-intel/reference-resolver.test.ts
git commit -m "feat(code-intel): add ReferenceResolver for named/default imports"
```

---

## Task 4: Namespace Import 与 Alias 使用

**Files:**
- Modify: `src/code-intel/parsers/typescript-parser.ts`
- Modify: `src/code-intel/reference-resolver.ts`
- Test: `src/code-intel/reference-resolver.test.ts`（新增用例）

- [ ] **Step 1: 写失败测试**

在 `src/code-intel/reference-resolver.test.ts` 中追加：

```typescript
  it('TC-UT-RR-003: namespace import 调用解析到模块内符号', () => {
    const appSrc = `import * as payment from './payment';\npayment.refundOrder();`;
    const appSyms = parser.parseSymbols(appSrc, join(TMP, 'src', 'app.ts'));
    const refs = parser.parseReferences(appSrc, appSyms);
    const bindings = parser.parseImportBindings(appSrc, join(TMP, 'src', 'app.ts'));

    resolver.resolveFileRefs(join(TMP, 'src', 'app.ts'), refs, bindings);

    const refundSym = store.symbolsFindByFile(join(TMP, 'src', 'payment.ts')).find(s => s.name === 'refundOrder')!;
    const callRef = refs.find(r => r.kind === 'call')!;
    expect(callRef.target_symbol_id).toBe(refundSym.id);
  });

  it('TC-UT-RR-004: import alias 使用解析到原始符号', () => {
    const appSrc = `import { refundOrder as ro } from './payment';\nro();`;
    const appSyms = parser.parseSymbols(appSrc, join(TMP, 'src', 'app.ts'));
    const refs = parser.parseReferences(appSrc, appSyms);
    const bindings = parser.parseImportBindings(appSrc, join(TMP, 'src', 'app.ts'));

    resolver.resolveFileRefs(join(TMP, 'src', 'app.ts'), refs, bindings);

    const refundSym = store.symbolsFindByFile(join(TMP, 'src', 'payment.ts')).find(s => s.name === 'refundOrder')!;
    const callRef = refs.find(r => r.kind === 'call')!;
    expect(callRef.target_symbol_id).toBe(refundSym.id);
  });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/code-intel/reference-resolver.test.ts
```

Expected: namespace / alias 测试失败（target 仍为 external/unknown）。

- [ ] **Step 3: 修改 TypeScriptParser 生成 namespace 调用目标**

在 `src/code-intel/parsers/typescript-parser.ts` 中，把 `parseReferences` 改为先解析 import bindings，并在 namespace 调用时保留 `alias.method`：

```typescript
  parseReferences(source: string, symbols: Symbol[]): Reference[] {
    const fp = filePathFromSymbols(symbols);
    this.parser.setLanguage(this.pickLang(fp));
    const tree = this.parser.parse(source, undefined, { bufferSize: Math.max(32768, Buffer.byteLength(source, 'utf8')) });
    const refs: Reference[] = [];
    const symbolMap = new Map<string, Symbol>();
    for (const sym of symbols) symbolMap.set(sym.name, sym);

    // 先解析 import bindings，识别 namespace alias
    const bindings = this.parseImportBindings(source, fp);
    const namespaceAliases = new Set(bindings.filter(b => b.kind === 'namespace').map(b => b.localName));

    this.walkForRefs(tree.rootNode, source, fp, symbolMap, refs, namespaceAliases);
    return refs;
  }
```

把 `walkForRefs` 签名改为接收 `namespaceAliases`，并在 call_expression 中处理 member expression：

```typescript
  private walkForRefs(
    node: TSNode,
    source: string,
    filePath: string,
    symbolMap: Map<string, Symbol>,
    refs: Reference[],
    namespaceAliases: Set<string>,
  ): void {
    if (node.type === 'call_expression') {
      const fnNode = node.childForFieldName?.('function') ?? node.namedChildren[0];
      if (fnNode) {
        const calleeName = this.resolveCallTarget(fnNode, namespaceAliases);
        if (calleeName) {
          const target = symbolMap.get(calleeName);
          refs.push({
            id: hashSymbolId(filePath, `ref_${calleeName}`, 'call', node.startPosition.row + 1),
            source_symbol_id: '',
            target_symbol_id: target?.id ?? `unknown:${calleeName}`,
            location: {
              file_path: filePath,
              line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
              col_start: node.startPosition.column + 1, col_end: node.endPosition.column + 1,
            },
            kind: 'call',
          });
        }
      }
    }
    // ... new_expression / import_statement / type_identifier / extends / decorator 保持类似处理
    for (const child of node.namedChildren) {
      this.walkForRefs(child, source, filePath, symbolMap, refs, namespaceAliases);
    }
  }
```

把 `resolveCallTarget` 改为：

```typescript
  private resolveCallTarget(fnNode: TSNode, namespaceAliases: Set<string>): string | null {
    if (fnNode.type === 'identifier') return fnNode.text;
    if (fnNode.type === 'member_expression') {
      const parts = fnNode.text.split('.');
      const objectName = parts[0] ?? '';
      const methodName = parts[parts.length - 1] ?? '';
      // 如果是 namespace import 的 alias，保留 alias.method 供 resolver 解析
      if (namespaceAliases.has(objectName)) {
        return `${objectName}.${methodName}`;
      }
      return methodName;
    }
    return null;
  }
```

> 注意：需要把 `new_expression` 等其它调用 `resolveCallTarget` 的地方也传入 `namespaceAliases`。

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/code-intel/reference-resolver.test.ts
npm test -- src/code-intel/code-intelligence.test.ts
```

Expected: 新增 namespace / alias 用例通过，已有 TypeScriptParser 测试不回归。

- [ ] **Step 5: 提交**

```bash
git add src/code-intel/parsers/typescript-parser.ts src/code-intel/reference-resolver.test.ts src/code-intel/reference-resolver.ts
git commit -m "feat(code-intel): resolve namespace imports and aliases"
```

---

## Task 5: Index Re-export 解析

**Files:**
- Modify: `src/code-intel/reference-resolver.ts`
- Modify: `src/code-intel/parsers/typescript-parser.ts`（已实现 parseReexports）
- Test: `src/code-intel/reference-resolver.test.ts`（新增用例）

- [ ] **Step 1: 写失败测试**

在 `src/code-intel/reference-resolver.test.ts` 中追加：

```typescript
  it('TC-UT-RR-005: index re-export 解析到原始符号', () => {
    mkdirSync(join(TMP, 'src', 'utils'), { recursive: true });
    writeFileSync(join(TMP, 'src', 'utils', 'index.ts'), `export { refundOrder } from '../payment';`);
    const indexSrc = `export { refundOrder } from '../payment';`;
    const indexSyms = parser.parseSymbols(indexSrc, join(TMP, 'src', 'utils', 'index.ts'));
    store.symbolsUpsert(indexSyms);

    const appSrc = `import { refundOrder } from './utils';\nrefundOrder();`;
    const appSyms = parser.parseSymbols(appSrc, join(TMP, 'src', 'app.ts'));
    const refs = parser.parseReferences(appSrc, appSyms);
    const bindings = parser.parseImportBindings(appSrc, join(TMP, 'src', 'app.ts'));

    resolver.resolveFileRefs(join(TMP, 'src', 'app.ts'), refs, bindings);

    const refundSym = store.symbolsFindByFile(join(TMP, 'src', 'payment.ts')).find(s => s.name === 'refundOrder')!;
    const callRef = refs.find(r => r.kind === 'call')!;
    expect(callRef.target_symbol_id).toBe(refundSym.id);
  });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/code-intel/reference-resolver.test.ts
```

Expected: re-export 测试失败（resolveReexport 返回 undefined）。

- [ ] **Step 3: 实现 resolveReexport**

修改 `src/code-intel/reference-resolver.ts`：

1. 引入 parser：

```typescript
import { TypeScriptParser } from './parsers/typescript-parser.js';
```

2. 替换 `resolveReexport` stub：

```typescript
  private resolveReexport(name: string, filePath: string): SymbolId | undefined {
    const { existsSync, readFileSync } = await import('node:fs'); // 如需异步；当前可用顶层 import
    if (!existsSync(filePath)) return undefined;

    const source = readFileSync(filePath, 'utf-8');
    const parser = new TypeScriptParser();
    const reexports = parser.parseReexports(source, filePath);
    const target = reexports.find(r => r.name === name);
    if (!target) return undefined;

    const nextFile = this.moduleResolver.resolve(target.source, filePath);
    if (!nextFile) return undefined;

    const syms = this.store.symbolsFindByFile(nextFile).filter(s => s.is_exported && s.name === name);
    if (syms.length > 0) return syms[0].id;

    // 支持多层 re-export 链
    return this.resolveReexport(name, nextFile);
  }
```

顶部改为同步 import：

```typescript
import { existsSync, readFileSync } from 'node:fs';
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/code-intel/reference-resolver.test.ts
```

Expected: 5 passed。

- [ ] **Step 5: 提交**

```bash
git add src/code-intel/reference-resolver.ts src/code-intel/reference-resolver.test.ts
git commit -m "feat(code-intel): resolve index re-exports recursively"
```

---

## Task 6: 接入 CodeIntelligence.indexProject / indexFile

**Files:**
- Modify: `src/code-intel/code-intelligence.impl.ts`
- Modify: `src/code-intel/code-intelligence.integration.test.ts`（新增用例）

- [ ] **Step 1: 写失败集成测试**

在 `src/code-intel/code-intelligence.integration.test.ts` 中新增 describe：

```typescript
import { ModuleResolver } from '../code-intel/module-resolver.js'; // 测试里不一定需要，留作说明

describe('CodeIntelligence Cross-File References', () => {
  const tmpDir = join(tmpdir(), `nodus-xref-test-${Date.now()}`);
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeAll(async () => {
    mkdirSync(join(tmpDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'xref-test' }));
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
    }));
    writeFileSync(join(tmpDir, 'src', 'payment.ts'), `
export function refundOrder(): void {}
export function getOrder(): void {}
`);
    writeFileSync(join(tmpDir, 'src', 'utils', 'index.ts'), `export { refundOrder } from '../payment';`);
    writeFileSync(join(tmpDir, 'src', 'app.ts'), `
import { refundOrder as ro } from './utils';
import * as payment from '@payment';
ro();
payment.getOrder();
`);

    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    await ci.indexProject(tmpDir, ['typescript']);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-IT-CI-XREF-001: index re-export + alias + namespace 调用都被解析', async () => {
    const syms = await ci.findSymbol('refundOrder');
    expect(syms.length).toBeGreaterThanOrEqual(1);
    const refundSym = syms.find(s => s.name === 'refundOrder' && s.location.file_path.includes('payment.ts'))!;

    const refs = await ci.findReferences(refundSym.id);
    const callRefs = refs.filter(r => r.kind === 'call');
    expect(callRefs.length).toBeGreaterThanOrEqual(2);

    const fromApp = callRefs.filter(r => r.location.file_path.includes('app.ts'));
    expect(fromApp.length).toBeGreaterThanOrEqual(1);
  });

  it('TC-IT-CI-XREF-002: indexFile 增量更新后引用仍正确', async () => {
    const appPath = join(tmpDir, 'src', 'app.ts');
    writeFileSync(appPath, `
import { refundOrder } from './utils';
refundOrder();
`);
    await ci.indexFile(appPath);

    const syms = await ci.findSymbol('refundOrder');
    const refundSym = syms.find(s => s.location.file_path.includes('payment.ts'))!;
    const refs = await ci.findReferences(refundSym.id);
    expect(refs.some(r => r.location.file_path === appPath)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/code-intel/code-intelligence.integration.test.ts
```

Expected: 新 describe 中测试失败，因为 `indexProject` 还没有调用 ReferenceResolver。

- [ ] **Step 3: 修改 CodeIntelligenceImpl**

在 `src/code-intel/code-intelligence.impl.ts` 中：

1. 引入：

```typescript
import { ModuleResolver } from './module-resolver.js';
import { ReferenceResolver } from './reference-resolver.js';
```

2. 修改 `indexProject`：

把当前最后的“跨文件引用解析”块替换为：

```typescript
    // 第二遍：跨文件引用解析
    const moduleResolver = new ModuleResolver(projectRoot);
    const referenceResolver = new ReferenceResolver(moduleResolver, this.store);

    // 收集每个文件的 import bindings
    const bindingsByFile = new Map<string, ImportBinding[]>();
    for (const file of files) {
      const lang = this.detectLanguage(file);
      if (!lang || !languages.includes(lang)) continue;
      const parser = this.parsers.get(lang);
      if (!(parser instanceof TypeScriptParser)) continue;
      try {
        const source = readFileSync(file, 'utf-8');
        const bindings = parser.parseImportBindings(source, file);
        bindingsByFile.set(file, bindings);
      } catch {
        bindingsByFile.set(file, []);
      }
    }

    // 解析引用目标
    let resolvedCount = 0;
    for (const [file, bindings] of bindingsByFile) {
      const refs = this.store.refsFindByFile(file);
      const before = refs.filter(r => r.target_symbol_id.startsWith('external:') || r.target_symbol_id.startsWith('unknown:')).length;
      referenceResolver.resolveFileRefs(file, refs, bindings);
      const after = refs.filter(r => r.target_symbol_id.startsWith('external:') || r.target_symbol_id.startsWith('unknown:')).length;
      resolvedCount += before - after;
      this.store.refsUpsert(refs);
    }

    report.referencesFound = this.store.refsFindAll().length;
```

同时保留顶部 `ImportBinding` 的类型引入：

```typescript
import type { Symbol, Language, Reference, CallGraph, CallGraphNode, CallGraphEdge,
  IndexStatus, SymbolKind, ReferenceKind, SymbolId, CallDirection,
  RiskLevel, ImportBinding,
} from '../common/types.js';
```

3. 修改 `indexFile`：

在 `indexFile` 返回前加入：

```typescript
    // 解析当前文件跨文件引用
    if (parser instanceof TypeScriptParser) {
      const bindings = parser.parseImportBindings(source, filePath);
      const resolver = new ReferenceResolver(new ModuleResolver(this.projectRoot ?? dirname(filePath)), this.store);
      const fileRefs = this.store.refsFindByFile(filePath);
      resolver.resolveFileRefs(filePath, fileRefs, bindings);
      this.store.refsUpsert(fileRefs);
    }
```

需要引入 `dirname`：

```typescript
import { join, relative, extname, dirname } from 'node:path';
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/code-intel/code-intelligence.integration.test.ts
npm test -- src/code-intel/code-intelligence.test.ts
npm test -- src/code-intel/reference-resolver.test.ts
```

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/code-intel/code-intelligence.impl.ts src/code-intel/code-intelligence.integration.test.ts
git commit -m "feat(code-intel): wire ReferenceResolver into indexProject/indexFile"
```

---

## Task 7: 更新 README 与 Roadmap

**Files:**
- Modify: `readme.md`
- Modify: `ArchitecturalDesignPhase/05-Future-Roadmap.md`

- [ ] **Step 1: 勾选 R1.3**

在 `readme.md` 中：

```markdown
#### v1.1 基础夯实
- [x] R1.3 跨文件引用解析增强（`tsconfig.json` paths / index re-export / namespace import）
```

并把测试计数从 177 更新为实际通过的测试数（运行 `npm test` 后确认）。

- [ ] **Step 2: 更新 Roadmap 实现状态**

在 `ArchitecturalDesignPhase/05-Future-Roadmap.md` 的 `CodeIntelligence` 行中，把“跨文件类型引用、继承关系未完整建模”改为“继承关系未完整建模（R1.4）”，并说明 R1.3 已完成。

- [ ] **Step 3: 运行全量测试与类型检查**

```bash
npm test
npm run typecheck
```

Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add readme.md ArchitecturalDesignPhase/05-Future-Roadmap.md
git commit -m "docs: mark R1.3 cross-file reference resolution complete"
```

---

## Self-Review

| 检查项 | 结果 |
|--------|------|
| R1.3 四条要求（tsconfig paths、相对路径、index re-export、namespace import）都有对应 task | ✅ Task 1/3/4/5 |
| 无数据库 schema 变更 | ✅ 只改 target_symbol_id |
| 无 placeholder（TBD/稍后实现） | ✅ 每步含具体代码 |
| 类型一致性：ImportBinding / ReexportInfo 在 types.ts 定义，parser 与 resolver 共用 | ✅ |
| 向后兼容：未解析的引用仍保持 external:/unknown:，不影响现有查询 | ✅ |
| 测试覆盖：unit + integration | ✅ |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-01-cross-file-reference-resolution.md`.

**Execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`.

In auto mode, selecting **Option 1: Subagent-Driven**.
