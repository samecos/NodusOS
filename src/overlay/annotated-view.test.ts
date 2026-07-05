import { describe, it, expect } from 'vitest';
import { renderAnnotatedView } from './annotated-view.js';
import type { DebtQueryResult } from '../understanding-debt/debt-engine.js';
import type { BriefCard } from '../common/types.js';

describe('renderAnnotatedView', () => {
  // TC-UT-AV-001: 应在改过的符号行旁标注债值
  it('TC-UT-AV-001: should annotate lines with debt info', () => {
    const code = 'export function foo() {\n  return 1;\n}\n';
    const debts: DebtQueryResult[] = [
      { symbol_id: 'a.ts:foo', name: 'foo', file_path: 'a.ts', debt: 3.5, level: 'red', examined: false, confirmed: false },
    ];
    const output = renderAnnotatedView('a.ts', code, debts, []);
    expect(output).toContain('foo');
    expect(output).toContain('3.5');
    expect(output).toContain('红'); // 红色标记
  });

  // TC-UT-AV-002: 应在旁挂简报摘要
  it('TC-UT-AV-002: should attach brief summary', () => {
    const code = 'export function bar() {\n  return 2;\n}\n';
    const debts: DebtQueryResult[] = [
      { symbol_id: 'b.ts:bar', name: 'bar', file_path: 'b.ts', debt: 2.0, level: 'yellow', examined: false, confirmed: false },
    ];
    const briefs: BriefCard[] = [{
      chunk_id: 'chunk-1', title: 'bar @ src', symbols: [{ name: 'bar', complexity: 3 }],
      impact_radius: 4, risk_level: 'medium', complexity_hotspots: ['bar'],
      test_coverage: false, known_issues: [], suggested_inspect_point: { file: 'b.ts', line: 1 },
    }];
    const output = renderAnnotatedView('b.ts', code, debts, briefs);
    expect(output).toContain('bar');
    expect(output).toContain('chunk-1');
  });

  // TC-UT-AV-003: 无债值时返回纯代码视图
  it('TC-UT-AV-003: should return plain code when no debt', () => {
    const code = 'const x = 1;\n';
    const output = renderAnnotatedView('c.ts', code, [], []);
    expect(output).toContain('const x = 1;');
  });
});
