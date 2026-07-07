// ============================================================
// CppParser 单元测试
// TC-UT-CP-001 ~ TC-UT-CP-005
// ============================================================

import { describe, it, expect } from 'vitest';
import { CppParser } from './cpp-parser.js';

describe('CppParser', () => {
  const parser = new CppParser();

  // TC-UT-CP-001: 解析普通函数定义
  it('TC-UT-CP-001: should parse global function definitions', () => {
    const source = `
int add(int a, int b) {
  return a + b;
}

void Foo::bar() {
  // method body
}
`;
    const result = parser.parse('test.cpp', source);
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('add');
    expect(names).toContain('bar');
    expect(result.symbols.find(s => s.name === 'add')?.location.line_start).toBe(2);
  });

  // TC-UT-CP-002: 解析命名空间限定函数
  it('TC-UT-CP-002: should parse namespace-qualified function names', () => {
    const source = `
namespace cv {
void stereoRectify(int a, int b)
{
}
}
`;
    const result = parser.parse('stereo.cpp', source);
    const sym = result.symbols.find(s => s.name === 'stereoRectify');
    expect(sym).toBeDefined();
    expect(sym?.kind).toBe('function');
  });

  // TC-UT-CP-003: 不将控制语句识别为函数定义
  it('TC-UT-CP-003: should not treat control statements as definitions', () => {
    const source = `
void process(int x) {
  if (x > 0) {
    helper(x);
  }
  for (int i = 0; i < x; i++) {
    helper(i);
  }
}
`;
    const result = parser.parse('control.cpp', source);
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('process');
    expect(names).not.toContain('if');
    expect(names).not.toContain('for');
  });

  // TC-UT-CP-004: 解析函数调用引用
  it('TC-UT-CP-004: should parse function call references', () => {
    const source = `
void process() {
  helper(1);
  cv::stereoRectify(2);
}
`;
    const result = parser.parse('refs.cpp', source);
    const targets = result.references.map(r => r.target_symbol_id);
    expect(targets).toContain('unknown:helper');
    expect(targets).toContain('unknown:stereoRectify');
  });

  // TC-UT-CP-005: 同一文件内引用可解析到定义
  it('TC-UT-CP-005: should resolve in-file calls to symbol ids', () => {
    const source = `
void helper() {}
void process() {
  helper();
}
`;
    const result = parser.parse('resolve.cpp', source);
    const helperSym = result.symbols.find(s => s.name === 'helper');
    const ref = result.references.find(r => r.target_symbol_id === helperSym?.id);
    expect(ref).toBeDefined();
  });
});
