// ============================================================
// ContextManager 单元测试 — TC-UT-CM-001 ~ TC-UT-CM-007
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultContextManager } from './context-manager.impl.js';

describe('ContextManager', () => {
  let ctx: DefaultContextManager;

  beforeEach(() => {
    ctx = new DefaultContextManager('/home/dev/default');
  });

  // TC-UT-CM-001: 初始状态
  it('TC-UT-CM-001: should have correct initial state', () => {
    const snap = ctx.snapshot();
    expect(snap.active_file).toBeNull();
    expect(snap.cursor_line).toBeNull();
    expect(snap.active_project_root).toBe('/home/dev/default');
    expect(snap.recent_queries).toHaveLength(0);
  });

  // TC-UT-CM-002: 文件打开更新
  it('TC-UT-CM-002: should update on file opened', () => {
    ctx.update({ kind: 'file_opened', path: 'src/main.ts' });
    expect(ctx.snapshot().active_file).toBe('src/main.ts');
  });

  // TC-UT-CM-003: 光标移动更新
  it('TC-UT-CM-003: should update on cursor moved', () => {
    ctx.update({ kind: 'cursor_moved', file: 'src/main.ts', line: 42, col: 10, symbol: 'main' });
    const snap = ctx.snapshot();
    expect(snap.cursor_line).toBe(42);
    expect(snap.cursor_col).toBe(10);
    expect(snap.cursor_symbol).toBe('main');
  });

  // TC-UT-CM-004: 选中代码更新
  it('TC-UT-CM-004: should update on selection changed', () => {
    ctx.update({ kind: 'selection_changed', file: 'src/a.ts', range: [10, 15], code: 'refundOrder()' });
    const snap = ctx.snapshot();
    expect(snap.selected_code).toBe('refundOrder()');
    expect(snap.selected_range).toEqual([10, 15]);
  });

  // TC-UT-CM-005: 项目切换
  it('TC-UT-CM-005: should reset on project changed', () => {
    ctx.update({ kind: 'file_opened', path: 'src/old.ts' });
    ctx.update({ kind: 'cursor_moved', file: 'src/old.ts', line: 1, col: 1, symbol: 'fn' });

    ctx.update({ kind: 'project_changed', root: '/home/dev/newproject' });

    const snap = ctx.snapshot();
    expect(snap.active_project_root).toBe('/home/dev/newproject');
    expect(snap.active_file).toBeNull(); // 切换项目后清空
    expect(snap.cursor_line).toBeNull();
  });

  // TC-UT-CM-006: 最近查询追踪（最多5条）
  it('TC-UT-CM-006: should track recent queries (max 5)', () => {
    for (let i = 0; i < 7; i++) {
      ctx.recordQuery(`query ${i}`, 'find_definition');
    }
    const recent = ctx.snapshot().recent_queries;
    expect(recent).toHaveLength(5);
    expect(recent[0]!.text).toBe('query 6'); // 最近在前
    expect(recent[4]!.text).toBe('query 2'); // 最早被丢弃
  });

  // TC-UT-CM-007: 上下文更新触发事件
  it('TC-UT-CM-007: should notify listeners on update', () => {
    const deltas: string[] = [];
    const unsub = ctx.onChange((delta) => {
      deltas.push(delta.kind);
    });

    ctx.update({ kind: 'file_opened', path: 'src/a.ts' });
    ctx.update({ kind: 'cursor_moved', file: 'src/a.ts', line: 5, col: 1, symbol: 'test' });

    expect(deltas).toEqual(['file_opened', 'cursor_moved']);

    // 取消订阅
    unsub();
    ctx.update({ kind: 'file_closed', path: 'src/a.ts' });
    expect(deltas).toHaveLength(2); // 不再增加
  });
});
