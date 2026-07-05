import type { SemanticChunk, BriefCard, ChangedSymbol } from '../common/types.js';
import type { RiskLevel } from '../common/types.js';

/**
 * 装配简报卡字段 — 全部从已有数据派生
 */
export function assembleBrief(
  chunk: SemanticChunk,
  symbols: ChangedSymbol[],
  impactRadius: number,
  riskLevel: RiskLevel,
  complexityMap: Map<string, number>,
  hasTestCoverage: boolean,
  knownIssues: string[],
): BriefCard {
  const symbolComplexities = chunk.symbols.map(s => ({
    name: s.name,
    complexity: complexityMap.get(s.symbol_id) ?? 0,
  }));

  const hotspots = symbolComplexities
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 2)
    .map(s => s.name);

  const inspectSym = chunk.symbols
    .slice()
    .sort((a, b) => (complexityMap.get(b.symbol_id) ?? 0) - (complexityMap.get(a.symbol_id) ?? 0))[0];

  return {
    chunk_id: chunk.id,
    title: chunk.title,
    symbols: symbolComplexities,
    impact_radius: impactRadius,
    risk_level: riskLevel,
    complexity_hotspots: hotspots,
    test_coverage: hasTestCoverage,
    known_issues: knownIssues,
    suggested_inspect_point: inspectSym
      ? { file: inspectSym.file_path, line: inspectSym.line_start }
      : null,
  };
}
