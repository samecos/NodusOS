import { describe, it, expect } from 'vitest';
import { SemanticChunkerImpl } from './semantic-chunker.impl.js';
import type { ChangeBatch, ChangedSymbol } from '../common/types.js';

function makeSymbol(id: string, name: string, file: string): ChangedSymbol {
  return { symbol_id: id, name, file_path: file, line_start: 1, line_end: 5, diff_text: `function ${name}() {}` };
}

function makeBatch(symbols: ChangedSymbol[]): ChangeBatch {
  return {
    id: 'test-batch', project_root: '/test', detected_at: new Date().toISOString(),
    files: [...new Set(symbols.map(s => s.file_path))], symbols,
    snapshot: {},
  };
}

describe('SemanticChunkerImpl', () => {
  // TC-UT-SC-001: 同文件符号应聚为一块
  it('TC-UT-SC-001: symbols in same file should cluster together', () => {
    const chunker = new SemanticChunkerImpl();
    const batch = makeBatch([
      makeSymbol('a.ts:foo', 'foo', 'a.ts'),
      makeSymbol('a.ts:bar', 'bar', 'a.ts'),
    ]);
    const chunks = chunker.chunk(batch);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.symbols).toHaveLength(2);
  });

  // TC-UT-SC-002: 不同文件不同模块应分块
  it('TC-UT-SC-002: symbols in different dirs should split', () => {
    const chunker = new SemanticChunkerImpl();
    const batch = makeBatch([
      makeSymbol('src/payment/charge.ts:charge', 'charge', 'src/payment/charge.ts'),
      makeSymbol('src/auth/login.ts:login', 'login', 'src/auth/login.ts'),
    ]);
    const chunks = chunker.chunk(batch);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  // TC-UT-SC-003: 简报字段非空
  it('TC-UT-SC-003: brief card should have all fields', () => {
    const chunker = new SemanticChunkerImpl();
    const batch = makeBatch([makeSymbol('a.ts:foo', 'foo', 'a.ts')]);
    const chunks = chunker.chunk(batch);
    const brief = chunker.brief(chunks[0]!, batch);
    expect(brief.title).toBeDefined();
    expect(brief.symbols).toHaveLength(1);
    expect(brief.risk_level).toBeDefined();
    expect(brief.suggested_inspect_point).not.toBeNull();
  });

  // TC-UT-SC-004: 超过 8 个符号应子聚类
  it('TC-UT-SC-004: more than 8 symbols should sub-cluster', () => {
    const chunker = new SemanticChunkerImpl();
    const symbols: ChangedSymbol[] = [];
    for (let i = 0; i < 12; i++) {
      symbols.push(makeSymbol(`a.ts:f${i}`, `f${i}`, 'a.ts'));
    }
    const batch = makeBatch(symbols);
    const chunks = chunker.chunk(batch);
    const maxChunkSize = Math.max(...chunks.map(c => c.symbols.length));
    expect(maxChunkSize).toBeLessThanOrEqual(8);
  });
});
