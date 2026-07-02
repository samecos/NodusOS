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

  it('TC-UT-RR-006: circular re-export 不会导致无限递归且引用保持未解析', () => {
    mkdirSync(join(TMP, 'src', 'a'), { recursive: true });
    writeFileSync(join(TMP, 'src', 'a', 'index.ts'), `export { refundOrder } from './b';`);
    writeFileSync(join(TMP, 'src', 'a', 'b.ts'), `export { refundOrder } from './a';`);

    const appSrc = `import { refundOrder } from './a';
refundOrder();`;
    const appSyms = parser.parseSymbols(appSrc, join(TMP, 'src', 'app.ts'));
    const refs = parser.parseReferences(appSrc, appSyms);
    const bindings = parser.parseImportBindings(appSrc, join(TMP, 'src', 'app.ts'));

    expect(() => resolver.resolveFileRefs(join(TMP, 'src', 'app.ts'), refs, bindings)).not.toThrow();

    const callRef = refs.find(r => r.kind === 'call')!;
    expect(callRef.target_symbol_id.startsWith('external:') || callRef.target_symbol_id.startsWith('unknown:')).toBe(true);
  });
});
