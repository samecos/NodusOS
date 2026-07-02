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

  it('TC-UT-TR-004: should render type_relationship_list', () => {
    const out = renderer.render({
      kind: 'type_relationship_list',
      root: {
        id: '1', name: 'IUserService', kind: 'interface', language: 'typescript',
        location: { file_path: 'src/service.ts', line_start: 1, line_end: 1, col_start: 1, col_end: 1 },
        is_exported: true,
      },
      relationships: [
        {
          kind: 'implementation',
          symbol: {
            id: '2', name: 'UserService', kind: 'class', language: 'typescript',
            location: { file_path: 'src/service.ts', line_start: 5, line_end: 5, col_start: 1, col_end: 1 },
            is_exported: true,
          },
        },
      ],
    });
    expect(out).toContain('IUserService');
    expect(out).toContain('UserService');
    expect(out).toContain('实现');
  });

  // TC-UT-UI-013: 调用图同名符号不合并
  it('TC-UT-UI-013: should not merge nodes with same symbol name', () => {
    const out = renderer.render({
      kind: 'call_graph',
      graph: {
        root_symbol_id: 'root-a',
        direction: 'callees',
        max_depth: 3,
        nodes: [
          { symbol_id: 'root-a', symbol_name: 'helper', file_path: 'src/a.ts', line: 1, depth: 0 },
          { symbol_id: 'child-b', symbol_name: 'helper', file_path: 'src/b.ts', line: 5, depth: 1 },
          { symbol_id: 'child-c', symbol_name: 'leaf', file_path: 'src/c.ts', line: 10, depth: 2 },
        ],
        edges: [
          { from: 'root-a', to: 'child-b', kind: 'call' },
          { from: 'child-b', to: 'child-c', kind: 'call' },
        ],
      },
    });
    expect(out).toContain('a.ts');
    expect(out).toContain('b.ts');
    expect(out).toContain('c.ts');
    // 两个 helper 都应该出现且各自保留位置信息（去掉 ANSI 颜色码后匹配）
    const matches = out.replace(/\u001b\[[0-9;]*m/g, '').match(/helper\s+\[/g);
    expect(matches).toHaveLength(2);
  });

  // TC-UT-UI-014: callers 方向应显示上游调用方
  it('TC-UT-UI-014: should render callers direction upstream', () => {
    const out = renderer.render({
      kind: 'call_graph',
      graph: {
        root_symbol_id: 'target',
        direction: 'callers',
        max_depth: 3,
        nodes: [
          { symbol_id: 'caller-a', symbol_name: 'callerA', file_path: 'src/a.ts', line: 1, depth: 0 },
          { symbol_id: 'target', symbol_name: 'targetFn', file_path: 'src/b.ts', line: 5, depth: 1 },
        ],
        edges: [{ from: 'caller-a', to: 'target', kind: 'call' }],
      },
    });
    expect(out).toContain('上游调用方');
    expect(out).toContain('callerA');
    expect(out).toContain('targetFn');
  });

  // TC-UT-UI-015: both 方向应同时显示 upstream 与 downstream
  it('TC-UT-UI-015: should render both directions with upstream and downstream', () => {
    const out = renderer.render({
      kind: 'call_graph',
      graph: {
        root_symbol_id: 'target',
        direction: 'both',
        max_depth: 3,
        nodes: [
          { symbol_id: 'caller-a', symbol_name: 'callerA', file_path: 'src/a.ts', line: 1, depth: 0 },
          { symbol_id: 'target', symbol_name: 'targetFn', file_path: 'src/b.ts', line: 5, depth: 1 },
          { symbol_id: 'callee-c', symbol_name: 'calleeC', file_path: 'src/c.ts', line: 10, depth: 1 },
        ],
        edges: [
          { from: 'caller-a', to: 'target', kind: 'call' },
          { from: 'target', to: 'callee-c', kind: 'call' },
        ],
      },
    });
    expect(out).toContain('上游');
    expect(out).toContain('下游');
    expect(out).toContain('callerA');
    expect(out).toContain('calleeC');
  });

  // TC-UT-UI-016: 边类型应被标注
  it('TC-UT-UI-016: should label edge kinds', () => {
    const out = renderer.render({
      kind: 'call_graph',
      graph: {
        root_symbol_id: 'root',
        direction: 'callees',
        max_depth: 3,
        nodes: [
          { symbol_id: 'root', symbol_name: 'Base', file_path: 'src/a.ts', line: 1, depth: 0 },
          { symbol_id: 'child', symbol_name: 'Child', file_path: 'src/b.ts', line: 5, depth: 1 },
        ],
        edges: [{ from: 'root', to: 'child', kind: 'inheritance' }],
      },
    });
    const lines = out.replace(/\u001b\[[0-9;]*m/g, '').split('\n');
    expect(lines.some(line => line.includes('Child') && line.includes('inheritance'))).toBe(true);
  });

  // TC-UT-UI-017: 超过 max_depth 应显示截断提示
  it('TC-UT-UI-017: should indicate depth truncation', () => {
    const out = renderer.render({
      kind: 'call_graph',
      graph: {
        root_symbol_id: 'root',
        direction: 'callees',
        max_depth: 1,
        nodes: [
          { symbol_id: 'root', symbol_name: 'main', file_path: 'src/a.ts', line: 1, depth: 0 },
          { symbol_id: 'child', symbol_name: 'child', file_path: 'src/b.ts', line: 5, depth: 1 },
          { symbol_id: 'grandchild', symbol_name: 'grandchild', file_path: 'src/c.ts', line: 10, depth: 2 },
        ],
        edges: [
          { from: 'root', to: 'child', kind: 'call' },
          { from: 'child', to: 'grandchild', kind: 'call' },
        ],
      },
    });
    const lines = out.replace(/\u001b\[[0-9;]*m/g, '').split('\n');
    expect(lines.some(line => line.includes('child') && line.includes('已截断'))).toBe(true);
  });

  // TC-UT-UI-018: 风险节点应高亮
  it('TC-UT-UI-018: should highlight risky nodes', () => {
    const out = renderer.render({
      kind: 'call_graph',
      graph: {
        root_symbol_id: 'root',
        direction: 'callees',
        max_depth: 3,
        nodes: [
          { symbol_id: 'root', symbol_name: 'main', file_path: 'src/a.ts', line: 1, depth: 0, has_risk: true },
          { symbol_id: 'child', symbol_name: 'child', file_path: 'src/b.ts', line: 5, depth: 1 },
        ],
        edges: [{ from: 'root', to: 'child', kind: 'call' }],
      },
    });
    expect(out).toContain('main');
    expect(out).toContain('child');
    // has_risk 标记会触发 ⚠ 输出
    expect(out).toContain('⚠');
  });

  // TC-UT-UI-019: 根节点缺失时应优雅降级
  it('TC-UT-UI-019: should gracefully handle missing root', () => {
    const out = renderer.render({
      kind: 'call_graph',
      graph: {
        root_symbol_id: 'missing',
        direction: 'callees',
        max_depth: 3,
        nodes: [
          { symbol_id: 'other', symbol_name: 'other', file_path: 'src/o.ts', line: 1, depth: 0 },
        ],
        edges: [],
      },
    });
    expect(out).toContain('调用图根节点不存在');
  });

  // TC-UT-UI-020: callers 方向应正确标注反向边类型
  it('TC-UT-UI-020: should label edge kinds for callers direction', () => {
    const out = renderer.render({
      kind: 'call_graph',
      graph: {
        root_symbol_id: 'target',
        direction: 'callers',
        max_depth: 3,
        nodes: [
          { symbol_id: 'caller-a', symbol_name: 'callerA', file_path: 'src/a.ts', line: 1, depth: 1 },
          { symbol_id: 'target', symbol_name: 'targetFn', file_path: 'src/b.ts', line: 5, depth: 0 },
        ],
        edges: [{ from: 'caller-a', to: 'target', kind: 'call' }],
      },
    });
    const lines = out.replace(/\u001b\[[0-9;]*m/g, '').split('\n');
    expect(lines.some(line => line.includes('callerA') && line.includes('call'))).toBe(true);
  });

  // TC-UT-UI-021: 空节点数组应提示调用图为空
  it('TC-UT-UI-021: should indicate empty call graph', () => {
    const out = renderer.render({
      kind: 'call_graph',
      graph: {
        root_symbol_id: 'root',
        direction: 'callees',
        max_depth: 3,
        nodes: [],
        edges: [],
      },
    });
    expect(out).toContain('调用图为空');
  });
});
