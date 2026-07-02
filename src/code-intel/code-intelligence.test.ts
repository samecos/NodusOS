// ============================================================
// Code Intelligence 单元测试
// TC-UT-CI-001 ~ TC-UT-CI-024
// ============================================================

import { describe, it, expect } from 'vitest';
import { TypeScriptParser } from './parsers/typescript-parser.js';
import { PythonParser } from './parsers/python-parser.js';

// ==========================================================
// TypeScript 解析测试
// ==========================================================
describe('TypeScriptParser', () => {
  const parser = new TypeScriptParser();

  // TC-UT-CI-001: 提取函数符号
  it('TC-UT-CI-001: should extract exported function symbol', () => {
    const source = 'export async function refundOrder(orderId: string): Promise<RefundResult> { return {}; }';
    const symbols = parser.parseSymbols(source, 'src/payment.ts');

    expect(symbols).toHaveLength(1);
    const fn = symbols[0]!;
    expect(fn.name).toBe('refundOrder');
    expect(fn.kind).toBe('function');
    expect(fn.is_exported).toBe(true);
    expect(fn.language).toBe('typescript');
    expect(fn.location.file_path).toBe('src/payment.ts');
    expect(fn.signature).toContain('orderId');
  });

  // TC-UT-CI-002: 提取类和方法
  it('TC-UT-CI-002: should extract class and methods', () => {
    const source = `
export class PaymentService {
  async refund(amount: number): Promise<void> {
    await this.gateway.refund(amount);
  }
  cancel(orderId: string): void {}
}`;
    const symbols = parser.parseSymbols(source, 'src/payment.ts');
    const names = symbols.map(s => ({ name: s.name, kind: s.kind }));

    expect(names).toContainEqual({ name: 'PaymentService', kind: 'class' });
    expect(names).toContainEqual({ name: 'refund', kind: 'method' });
    expect(names).toContainEqual({ name: 'cancel', kind: 'method' });

    // refund 的 parent 应为 PaymentService
    const refund = symbols.find(s => s.name === 'refund')!;
    const classSymbol = symbols.find(s => s.name === 'PaymentService')!;
    expect(refund.parent_id).toBe(classSymbol.id);
  });

  // TC-UT-CI-003: 提取引用关系
  it('TC-UT-CI-003: should extract call references', () => {
    const source = `
import { refundOrder } from './payment';
refundOrder(100);
`;
    const symbols = parser.parseSymbols(source, 'src/test.ts');
    const refs = parser.parseReferences(source, symbols);

    // 应该有1个import引用 + 1个call引用
    const calls = refs.filter(r => r.kind === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  // TC-UT-CI-007: JS 箭头函数
  it('TC-UT-CI-007: should extract arrow function assigned to variable', () => {
    const source = 'const refund = async (orderId: string) => { return {}; };';
    const symbols = parser.parseSymbols(source, 'src/test.ts');

    const refund = symbols.find(s => s.name === 'refund');
    expect(refund).toBeDefined();
    expect(refund!.kind).toBe('variable');
  });

  // TC-UT-CI-010: 空文件
  it('TC-UT-CI-010: should handle empty file', () => {
    const symbols = parser.parseSymbols('', 'src/empty.ts');
    expect(symbols).toHaveLength(0);
  });

  // TC-UT-CI-016: 正确识别导出与非导出符号
  it('TC-UT-CI-016: should distinguish exported and non-exported symbols', () => {
    const source = `
function internalHelper(): void {}
export function publicApi(): void {}

class InternalClass {}
export class PublicClass {}
`;
    const symbols = parser.parseSymbols(source, 'src/export.ts');
    const internalFn = symbols.find(s => s.name === 'internalHelper');
    const publicFn = symbols.find(s => s.name === 'publicApi');
    const internalClass = symbols.find(s => s.name === 'InternalClass');
    const publicClass = symbols.find(s => s.name === 'PublicClass');

    expect(internalFn).toBeDefined();
    expect(publicFn).toBeDefined();
    expect(internalClass).toBeDefined();
    expect(publicClass).toBeDefined();

    expect(internalFn!.is_exported).toBe(false);
    expect(publicFn!.is_exported).toBe(true);
    expect(internalClass!.is_exported).toBe(false);
    expect(publicClass!.is_exported).toBe(true);
  });

  // TC-UT-CI-018: 识别类型引用
  it('TC-UT-CI-018: should extract type use references', () => {
    const source = `
interface RefundResult {
  status: string;
}

export function refundOrder(orderId: string): Promise<RefundResult> {
  return Promise.resolve({ status: 'ok' });
}
`;
    const symbols = parser.parseSymbols(source, 'src/payment.ts');
    const refundResult = symbols.find(s => s.name === 'RefundResult')!;
    const refs = parser.parseReferences(source, symbols);

    const typeUses = refs.filter(r => r.kind === 'type_use');
    expect(typeUses.length).toBeGreaterThanOrEqual(1);
    expect(typeUses.map(r => r.target_symbol_id)).toContain(refundResult.id);
  });

  // TC-UT-CI-019: 识别继承关系
  it('TC-UT-CI-019: should extract inheritance references', () => {
    const source = `
class BaseService {}
export class PaymentService extends BaseService {}
`;
    const symbols = parser.parseSymbols(source, 'src/payment.ts');
    const baseService = symbols.find(s => s.name === 'BaseService')!;
    const refs = parser.parseReferences(source, symbols);

    const inheritances = refs.filter(r => r.kind === 'inheritance');
    expect(inheritances.length).toBeGreaterThanOrEqual(1);
    expect(inheritances.map(r => r.target_symbol_id)).toContain(baseService.id);
  });

  // TC-UT-CI-025: 识别 new 表达式实例化引用
  it('TC-UT-CI-025: should extract new expression references', () => {
    const source = `
class PaymentService {}
const service = new PaymentService();
`;
    const symbols = parser.parseSymbols(source, 'src/payment.ts');
    const serviceClass = symbols.find(s => s.name === 'PaymentService')!;
    const refs = parser.parseReferences(source, symbols);

    const instantiations = refs.filter(r => r.kind === 'instantiation');
    expect(instantiations.length).toBeGreaterThanOrEqual(1);
    expect(instantiations.map(r => r.target_symbol_id)).toContain(serviceClass.id);
  });

  // TC-UT-CI-022: 提取 interface 符号
  it('TC-UT-CI-022: should extract interface symbol', () => {
    const source = `
export interface RefundResult {
  status: string;
  amount: number;
}
`;
    const symbols = parser.parseSymbols(source, 'src/types.ts');
    const iface = symbols.find(s => s.name === 'RefundResult');
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe('interface');
    expect(iface!.is_exported).toBe(true);
  });

  // TC-UT-CI-023: 提取 type alias 符号
  it('TC-UT-CI-023: should extract type alias symbol', () => {
    const source = `
export type OrderId = string;
`;
    const symbols = parser.parseSymbols(source, 'src/types.ts');
    const typeAlias = symbols.find(s => s.name === 'OrderId');
    expect(typeAlias).toBeDefined();
    expect(typeAlias!.kind).toBe('type');
    expect(typeAlias!.is_exported).toBe(true);
  });

  // TC-UT-CI-024: 提取 enum 符号
  it('TC-UT-CI-024: should extract enum symbol', () => {
    const source = `
export enum RefundStatus {
  Pending = 'pending',
  Completed = 'completed',
}
`;
    const symbols = parser.parseSymbols(source, 'src/types.ts');
    const enumSym = symbols.find(s => s.name === 'RefundStatus');
    expect(enumSym).toBeDefined();
    expect(enumSym!.kind).toBe('enum');
    expect(enumSym!.is_exported).toBe(true);
  });

  // TC-UT-CI-026: 识别装饰器引用
  it('TC-UT-CI-026: should extract decorator references', () => {
    const source = `
function Controller(prefix: string) {
  return function (target: any) {};
}

@Controller('/payments')
export class PaymentController {}
`;
    const symbols = parser.parseSymbols(source, 'src/payment.ts');
    const controller = symbols.find(s => s.name === 'Controller')!;
    const refs = parser.parseReferences(source, symbols);

    const decorators = refs.filter(r => r.kind === 'decorator_use');
    expect(decorators.length).toBeGreaterThanOrEqual(1);
    expect(decorators.map(r => r.target_symbol_id)).toContain(controller.id);
  });

  // TC-UT-CI-008: 语法错误文件 — 务实降级
  it('TC-UT-CI-008: should not throw on syntax error', () => {
    const source = 'function broken({' ; // 语法错误
    // tree-sitter 容错，应返回符号（尽力而为）或不抛异常
    expect(() => parser.parseSymbols(source, 'src/broken.ts')).not.toThrow();
  });

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
});

// ==========================================================
// Python 解析测试
// ==========================================================
describe('PythonParser', () => {
  const parser = new PythonParser();

  // TC-UT-CI-004: Python 函数
  it('TC-UT-CI-004: should extract Python function', () => {
    const source = `
def refund_order(order_id: str) -> dict:
    """Process a refund."""
    return {"status": "ok"}
`;
    const symbols = parser.parseSymbols(source, 'src/payment.py');

    const fn = symbols.find(s => s.name === 'refund_order');
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe('function');
    expect(fn!.language).toBe('python');
  });

  // TC-UT-CI-005: Python 类和方法
  it('TC-UT-CI-005: should extract Python class and methods', () => {
    const source = `
class PaymentService:
    def refund(self, amount: float) -> None:
        pass

    def cancel(self, order_id: str) -> None:
        pass
`;
    const symbols = parser.parseSymbols(source, 'src/payment.py');
    const names = symbols.map(s => ({ name: s.name, kind: s.kind }));

    expect(names).toContainEqual({ name: 'PaymentService', kind: 'class' });
    expect(names).toContainEqual({ name: 'refund', kind: 'method' });
    expect(names).toContainEqual({ name: 'cancel', kind: 'method' });
  });

  // TC-UT-CI-006: Python 调用引用（新增）
  it('TC-UT-CI-006: should extract Python call references', () => {
    const source = `
def refund_order(amount):
    return process_payment(amount)

def process_payment(amount):
    return True

refund_order(100)
`;
    const symbols = parser.parseSymbols(source, 'src/test.py');
    const refs = parser.parseReferences(source, symbols);

    // 应该包含对 process_payment 的调用引用（target_symbol_id 含 process_payment 或为哈希）
    const callRefs = refs.filter(r => r.kind === 'call');
    expect(callRefs.length).toBeGreaterThanOrEqual(1);
    // 至少有两处调用：refund_order内调用process_payment + 模块级调用refund_order
    expect(callRefs.length).toBeGreaterThanOrEqual(2);
  });

  // Python 调用边
  it('should extract Python call edges', () => {
    const source = `
def refund_order(amount):
    return process_payment(amount)

def process_payment(amount):
    return True
`;
    const symbols = parser.parseSymbols(source, 'src/test.py');
    const edges = parser.parseCallEdges(source, symbols);

    // refund_order 内调用了 process_payment
    const edge = edges.find(e => e.caller_name === 'refund_order');
    expect(edge).toBeDefined();
    expect(edge!.callee_name).toBe('process_payment');
  });

  // Python import 引用
  it('should extract Python import references', () => {
    const source = `
import os
from payment import refund_order

refund_order(100)
os.path.join('/tmp', 'test')
`;
    const symbols = parser.parseSymbols(source, 'src/test.py');
    const refs = parser.parseReferences(source, symbols);

    const importRefs = refs.filter(r => r.kind === 'import');
    expect(importRefs.length).toBeGreaterThanOrEqual(1);
  });

  // TC-UT-CI-017: parseReferences 应使用 symbols 中的文件路径
  it('TC-UT-CI-017: should use file path from symbols in references', () => {
    const source = `
def refund_order(amount):
    return process_payment(amount)

refund_order(100)
`;
    const customPath = 'src/payment/core.py';
    const symbols = parser.parseSymbols(source, customPath);
    const refs = parser.parseReferences(source, symbols);

    expect(refs.length).toBeGreaterThanOrEqual(1);
    for (const ref of refs) {
      expect(ref.location.file_path).toBe(customPath);
    }
  });
});
