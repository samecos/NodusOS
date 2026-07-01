// ============================================================
// TerminalRenderer 测试
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalRenderer } from './terminal-renderer.js';

describe('TerminalRenderer', () => {
  let renderer: TerminalRenderer;

  beforeEach(() => {
    renderer = new TerminalRenderer();
  });

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

  // TC-UT-UI-001: 卡片创建与列出
  it('TC-UT-UI-001: should create and list cards', () => {
    const card = renderer.createCard('c1', 'Results', {
      kind: 'symbol_list',
      symbols: [],
    });
    expect(card.id).toBe('c1');
    expect(card.kind).toBe('symbol_list');
    expect(renderer.listCards()).toHaveLength(1);
  });

  // TC-UT-UI-002: 关闭卡片
  it('TC-UT-UI-002: should dismiss cards', () => {
    renderer.createCard('c2', 'Results', { kind: 'symbol_list', symbols: [] });
    renderer.dismissCard('c2');
    expect(renderer.listCards()).toHaveLength(0);
  });

  // TC-UT-UI-003: 渲染代码片段
  it('TC-UT-UI-003: should render code snippet placeholder', () => {
    const out = renderer.renderCodeSnippet('src/a.ts', { start: 10, end: 20 });
    expect(out).toContain('src/a.ts');
    expect(out).toContain('10');
    expect(out).toContain('20');
  });

  // TC-UT-UI-004: 代码导航输出
  it('TC-UT-UI-004: should navigate to symbol', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    renderer.navigateToSymbol('src/a.ts', 42, 3);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // TC-UT-UI-005: 呼吸灯状态
  it('TC-UT-UI-005: should set breath light state', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    renderer.setBreathLight('thinking');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // TC-UT-UI-006: 排行榜渲染
  it('TC-UT-UI-006: should render symbol ranking', () => {
    const out = renderer.render({
      kind: 'symbol_ranking',
      title: 'Most Called Functions',
      metrics: [
        {
          symbol: {
            id: 'sym_a', name: 'processOrder', kind: 'function', language: 'typescript',
            location: { file_path: 'src/order.ts', line_start: 10, line_end: 20, col_start: 0, col_end: 1 },
            is_exported: true,
          },
          metric: 42,
          detail: 'calls',
        },
      ],
    });
    expect(out).toContain('Most Called Functions');
    expect(out).toContain('processOrder');
    expect(out).toContain('42');
  });

  // TC-UT-UI-007: 模块耦合度表格渲染
  it('TC-UT-UI-007: should render module coupling table', () => {
    const out = renderer.render({
      kind: 'module_coupling',
      couplings: [
        { moduleA: 'src/a.ts', moduleB: 'src/b.ts', referenceCount: 12 },
        { moduleA: 'src/c.ts', moduleB: 'src/d.ts', referenceCount: 5 },
      ],
    });
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
    expect(out).toContain('12');
    expect(out).toContain('src/c.ts');
    expect(out).toContain('5');
  });

  // TC-UT-UI-008: 调用链渲染
  it('TC-UT-UI-008: should render call chains', () => {
    const out = renderer.render({
      kind: 'call_chain',
      chains: [
        {
          chain: [
            { id: 's1', name: 'a', kind: 'function', language: 'typescript', location: { file_path: 'src/a.ts', line_start: 1, line_end: 1, col_start: 0, col_end: 1 }, is_exported: true },
            { id: 's2', name: 'b', kind: 'function', language: 'typescript', location: { file_path: 'src/b.ts', line_start: 1, line_end: 1, col_start: 0, col_end: 1 }, is_exported: true },
          ],
          depth: 2,
        },
      ],
    });
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('depth: 2');
  });

  // TC-UT-UI-009: TODO 列表渲染
  it('TC-UT-UI-009: should render TODO list', () => {
    const out = renderer.render({
      kind: 'todo_list',
      comments: [
        { filePath: 'src/a.ts', line: 10, text: 'fix edge case', kind: 'TODO' },
        { filePath: 'src/b.ts', line: 20, text: 'refactor', kind: 'FIXME' },
      ],
    });
    expect(out).toContain('TODO');
    expect(out).toContain('FIXME');
    expect(out).toContain('fix edge case');
    expect(out).toContain('src/a.ts:10');
  });

  // TC-UT-UI-010: 卡片识别新 analytics 类型
  it('TC-UT-UI-010: should infer card kind for analytics results', () => {
    const card = renderer.createCard('c3', 'Ranking', {
      kind: 'symbol_ranking',
      title: 'Top Functions',
      metrics: [],
    });
    expect(card.kind).toBe('symbol_ranking');
  });

  // TC-UT-UI-011: 统计报告渲染
  it('TC-UT-UI-011: should render stats report', () => {
    const out = renderer.render({
      kind: 'stats_report',
      stats: { totalSymbols: 100, totalReferences: 250, exportedSymbols: 30, filesIndexed: 12 },
    });
    expect(out).toContain('100');
    expect(out).toContain('250');
    expect(out).toContain('30');
    expect(out).toContain('12');
  });

  // TC-UT-UI-012: 变更热点渲染
  it('TC-UT-UI-012: should render change heat', () => {
    const out = renderer.render({
      kind: 'change_heat',
      files: [
        { filePath: 'src/hot.ts', changeCount: 15 },
        { filePath: 'src/cold.ts', changeCount: 2 },
      ],
    });
    expect(out).toContain('src/hot.ts');
    expect(out).toContain('15');
    expect(out).toContain('src/cold.ts');
    expect(out).toContain('2');
  });
});
