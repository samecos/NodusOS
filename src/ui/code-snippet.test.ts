// ============================================================
// CodeSnippet 单元测试 — TC-UT-CS-001 ~ TC-UT-CS-005
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSnippet, highlightLine, renderSnippet } from './code-snippet.js';

let tmpDir: string;

function makeFile(name: string, content: string): string {
  if (!tmpDir) tmpDir = mkdtempSync(join(tmpdir(), 'nodus-snippet-test-'));
  const path = join(tmpDir, name);
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('CodeSnippet', () => {
  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  // TC-UT-CS-001: 读取文件片段
  it('TC-UT-CS-001: should read lines around center line', () => {
    const file = makeFile('test.ts', [
      'import { foo } from "./bar";',
      '',
      'export function refundOrder(id: string) {',
      '  return processRefund(id);',
      '}',
      '',
      'function processRefund(id: string) {',
      '  return true;',
      '}',
    ].join('\n'));

    // 读第 3 行（refundOrder 函数）
    const lines = readFileSnippet(file, 3, 1);
    expect(lines).toHaveLength(3); // 行2,3,4
    expect(lines[0]!.lineNumber).toBe(2);
    expect(lines[0]!.isTarget).toBe(false);
    expect(lines[1]!.lineNumber).toBe(3);
    expect(lines[1]!.isTarget).toBe(true);
    expect(lines[1]!.text).toContain('refundOrder');
    expect(lines[2]!.lineNumber).toBe(4);
  });

  // TC-UT-CS-002: 文件不存在时返回空
  it('TC-UT-CS-002: should return empty array for missing file', () => {
    const lines = readFileSnippet('/nonexistent/file.ts', 1);
    expect(lines).toEqual([]);
  });

  // TC-UT-CS-003: JS/TS 语法高亮
  it('TC-UT-CS-003: should highlight TypeScript keywords and strings', () => {
    const result = highlightLine('const x: number = 42;', 'typescript');
    // const 应为蓝色
    expect(result).toContain('\x1b[36mconst\x1b[0m');
    // 42 应为黄色
    expect(result).toContain('\x1b[33m42\x1b[0m');
  });

  // TC-UT-CS-004: Python 语法高亮
  it('TC-UT-CS-004: should highlight Python keywords', () => {
    const result = highlightLine('def refund_order(order_id: str) -> bool:', 'python');
    expect(result).toContain('\x1b[36mdef\x1b[0m');
  });

  // TC-UT-CS-005: 注释应灰色
  it('TC-UT-CS-005: should render comments in dim', () => {
    const tsComment = highlightLine('// this is a comment', 'typescript');
    expect(tsComment).toContain('\x1b[2m//');

    const pyComment = highlightLine('# python comment', 'python');
    expect(pyComment).toContain('\x1b[2m#');
  });

  // TC-UT-CS-006: renderSnippet 应带文件头和行号
  it('TC-UT-CS-006: renderSnippet should include file path and line numbers', () => {
    const lines = [
      { text: 'function foo() {', lineNumber: 10, isTarget: false },
      { text: '  return bar;', lineNumber: 11, isTarget: true },
      { text: '}', lineNumber: 12, isTarget: false },
    ];
    const out = renderSnippet('src/test.ts', lines, 'typescript');
    expect(out).toContain('src/test.ts');
    expect(out).toContain('10');
    expect(out).toContain('11');
    expect(out).toContain('12');
    // 目标行应有 → 标记
    expect(out).toContain('→');
    expect(out).toContain('bar');
  });

  // TC-UT-CS-007: 空行不应报错
  it('TC-UT-CS-007: should handle empty lines gracefully', () => {
    const result = highlightLine('', 'typescript');
    expect(result).toBe('');
  });

  // TC-UT-CS-008: 字符串高亮应正确
  it('TC-UT-CS-008: should highlight string literals', () => {
    const result = highlightLine('const msg = "hello world";', 'typescript');
    expect(result).toContain('\x1b[32m');
  });
});
