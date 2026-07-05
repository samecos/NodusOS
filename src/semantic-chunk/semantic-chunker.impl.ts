import type { ChangeBatch, SemanticChunk, BriefCard, ChangedSymbol, RiskLevel } from '../common/types.js';
import type { SemanticChunker } from './semantic-chunker.js';
import { assembleBrief } from './brief-template.js';

const MAX_CHUNK_SIZE = 8;

/**
 * 语义切片器实现 — 按文件+模块目录聚类，超过大小上限时子聚类
 * P1 简化版：无调用图时按文件目录连通性聚类（同一文件/同一一级目录归一块）
 */
export class SemanticChunkerImpl implements SemanticChunker {
  chunk(batch: ChangeBatch): SemanticChunk[] {
    if (batch.symbols.length === 0) return [];

    // 按一级模块目录分组
    const groups = new Map<string, ChangedSymbol[]>();
    for (const sym of batch.symbols) {
      const moduleDir = this.getModuleDir(sym.file_path);
      const key = moduleDir;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(sym);
    }

    // 对每个组做子聚类（控制块大小）
    const chunks: SemanticChunk[] = [];
    let chunkIndex = 0;
    for (const [moduleDir, syms] of groups) {
      if (syms.length <= MAX_CHUNK_SIZE) {
        chunks.push(this.makeChunk(`chunk-${chunkIndex++}`, syms, moduleDir));
      } else {
        // 按 8 个一组切
        for (let i = 0; i < syms.length; i += MAX_CHUNK_SIZE) {
          const slice = syms.slice(i, i + MAX_CHUNK_SIZE);
          chunks.push(this.makeChunk(`chunk-${chunkIndex++}`, slice, moduleDir));
        }
      }
    }
    return chunks;
  }

  brief(chunk: SemanticChunk, _batch: ChangeBatch): BriefCard {
    const complexityMap = new Map<string, number>();
    for (const s of chunk.symbols) {
      // P1 启发式：diff 行数作为复杂度代理
      complexityMap.set(s.symbol_id, Math.min(s.diff_text.split('\n').length, 10));
    }

    const impactRadius = chunk.files.length * 2; // P1 简化
    const riskLevel: RiskLevel = chunk.symbols.length > 5 ? 'high' : chunk.symbols.length > 2 ? 'medium' : 'low';

    return assembleBrief(
      chunk,
      chunk.symbols,
      impactRadius,
      riskLevel,
      complexityMap,
      false, // P1 简化：暂不查测试覆盖
      [],    // P1 简化：暂不查已知隐患
    );
  }

  private makeChunk(id: string, syms: ChangedSymbol[], moduleDir: string): SemanticChunk {
    const files = [...new Set(syms.map(s => s.file_path))];
    const mostFreqName = this.mostFrequent(syms.map(s => s.name));
    return {
      id,
      symbols: syms,
      files,
      title: `${mostFreqName} @ ${moduleDir}`,
    };
  }

  private getModuleDir(filePath: string): string {
    const parts = filePath.split('/');
    if (parts.length <= 1) return parts[0] ?? 'root';
    if (parts[0] === 'src' && parts.length > 2) return parts.slice(0, 2).join('/');
    return parts[0] ?? 'root';
  }

  private mostFrequent(arr: string[]): string {
    const counts = new Map<string, number>();
    for (const s of arr) counts.set(s, (counts.get(s) ?? 0) + 1);
    let max = '';
    let maxCount = 0;
    for (const [s, c] of counts) {
      if (c > maxCount) { max = s; maxCount = c; }
    }
    return max;
  }
}
