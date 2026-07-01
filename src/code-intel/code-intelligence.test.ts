// ============================================================
// Code Intelligence 单元测试
// TC-UT-CI-001 ~ TC-UT-CI-015
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

  // TC-UT-CI-008: 语法错误文件 — 务实降级
  it('TC-UT-CI-008: should not throw on syntax error', () => {
    const source = 'function broken({' ; // 语法错误
    // tree-sitter 容错，应返回符号（尽力而为）或不抛异常
    expect(() => parser.parseSymbols(source, 'src/broken.ts')).not.toThrow();
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
});
