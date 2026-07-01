// ============================================================
// TerminalRenderer 测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { TerminalRenderer } from './terminal-renderer.js';

describe('TerminalRenderer', () => {
  const renderer = new TerminalRenderer();

  it('should render symbol list', () => {
    const out = renderer.render({
      kind: 'symbol_list',
      symbols: [{
        id: 'abc', name: 'refundOrder', kind: 'function', language: 'typescript',
        location: { file_path: 'src/payment.ts', line_start: 42, line_end: 48, col_start: 1, col_end: 2 },
        is_exported: true, signature: '(orderId: string) => Promise<Result>',
      }],
    });
    expect(out).toContain('refundOrder');
    expect(out).toContain('function');
    expect(out).toContain('src/payment.ts');
  });

  it('should render empty symbol list', () => {
    const out = renderer.render({ kind: 'symbol_list', symbols: [] });
    expect(out).toContain('未找到');
  });

  it('should render reference list', () => {
    const out = renderer.render({
      kind: 'reference_list',
      references: [
        {
          id: 'r1', source_symbol_id: 's1', target_symbol_id: 't1',
          location: { file_path: 'src/a.ts', line_start: 10, line_end: 10, col_start: 1, col_end: 5 },
          kind: 'call',
        },
        {
          id: 'r2', source_symbol_id: 's2', target_symbol_id: 't1',
          location: { file_path: 'src/b.ts', line_start: 20, line_end: 20, col_start: 1, col_end: 5 },
          kind: 'call',
        },
      ],
    });
    expect(out).toContain('2 处引用');
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
  });

  it('should render call graph', () => {
    const out = renderer.render({
      kind: 'call_graph',
      graph: {
        root_symbol_id: 'root',
        direction: 'both',
        max_depth: 3,
        nodes: [
          { symbol_id: 'root', symbol_name: 'main', file_path: 'src/a.ts', line: 1, depth: 0 },
          { symbol_id: 'child', symbol_name: 'helper', file_path: 'src/b.ts', line: 5, depth: 1 },
        ],
        edges: [{ from: 'root', to: 'child', kind: 'call' }],
      },
    });
    expect(out).toContain('调用图');
    expect(out).toContain('main');
    expect(out).toContain('helper');
  });

  it('should render intent error', () => {
    const out = renderer.renderError({ kind: 'empty_input' });
    expect(out).toContain('请输入');
  });

  it('should render unparseable error', () => {
    const out = renderer.renderError({ kind: 'unparseable', rawText: 'xyzzy' });
    expect(out).toContain('xyzzy');
  });
});
