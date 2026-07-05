import { describe, it, expect } from 'vitest';
import { classifyDiff } from './tag-classifier.js';

describe('TagClassifier', () => {
  // TC-UT-TC-001: 新增 null 检查
  it('TC-UT-TC-001: should detect add_null_check', () => {
    const before = 'const result = service.call();\nreturn result;';
    const after = 'const result = service.call();\nif (!result) return null;\nreturn result;';
    const tags = classifyDiff(before, after);
    expect(tags).toContain('add_null_check');
  });

  // TC-UT-TC-002: 新增 try/catch
  it('TC-UT-TC-002: should detect add_error_handling', () => {
    const before = 'const data = JSON.parse(str);\nreturn data;';
    const after = 'try {\n  const data = JSON.parse(str);\n  return data;\n} catch (e) {\n  return null;\n}';
    const tags = classifyDiff(before, after);
    expect(tags).toContain('add_error_handling');
  });

  // TC-UT-TC-003: 删除 console.log
  it('TC-UT-TC-003: should detect remove_debug', () => {
    const before = 'console.log("debug", x);\nreturn x;';
    const after = 'return x;';
    const tags = classifyDiff(before, after);
    expect(tags).toContain('remove_debug');
  });

  // TC-UT-TC-004: 新增类型标注
  it('TC-UT-TC-004: should detect add_type', () => {
    const before = 'function foo(x) { return x; }';
    const after = 'function foo(x: number): number { return x; }';
    const tags = classifyDiff(before, after);
    expect(tags).toContain('add_type');
  });

  // TC-UT-TC-005: 无变化时返回空数组
  it('TC-UT-TC-005: should return empty for no change', () => {
    const tags = classifyDiff('let x = 1;', 'let x = 1;');
    expect(tags).toEqual([]);
  });
});
