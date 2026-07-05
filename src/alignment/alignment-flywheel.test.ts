import { describe, it, expect } from 'vitest';
import { NodusMdEmitter } from './emitters/nodus-md-emitter.js';
import type { Convention } from '../common/types.js';

describe('NodusMdEmitter', () => {
  // TC-UT-AF-001: 渲染非空约定列表
  it('TC-UT-AF-001: should render conventions list', () => {
    const emitter = new NodusMdEmitter();
    const conventions: Convention[] = [
      { tag: 'add_null_check', pattern_desc: '调用外部服务后未判空', occurrences: 5, symbol_examples: 'PaymentService.charge', last_seen: Date.now() },
      { tag: 'add_type', pattern_desc: '函数参数未标注类型', occurrences: 3, symbol_examples: null, last_seen: Date.now() },
    ];
    const output = emitter.render(conventions);
    expect(output).toContain('add_null_check');
    expect(output).toContain('出现 5 次');
    expect(output).toContain('PaymentService.charge');
    expect(output).toContain('add_type');
  });

  // TC-UT-AF-002: 空列表渲染占位
  it('TC-UT-AF-002: should render placeholder for empty list', () => {
    const emitter = new NodusMdEmitter();
    const output = emitter.render([]);
    expect(output).toContain('暂无');
  });
});
