// ============================================================
// DefaultCodeAnalytics — 代码库级聚合、统计与分析实现
// ============================================================

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { execSync } from 'child_process';
import type {
  Symbol, SymbolId, ReferenceKind,
} from '../common/types.js';
import type { RelationshipKind, TypeRelationship } from './code-intelligence.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type {
  CodeAnalytics,
  SymbolListFilter,
  SymbolMetric,
  ModuleCoupling,
  CallChain,
  ComplexityScore,
  TodoComment,
} from './code-analytics.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.mjs', '.cjs']);

export class DefaultCodeAnalytics implements CodeAnalytics {
  constructor(private store: KnowledgeStore, private projectPath: string) {}

  async listSymbols(filter: SymbolListFilter): Promise<Symbol[]> {
    let symbols = this.store.symbolsFindAll();
    if (filter.kind) {
      symbols = symbols.filter(s => s.kind === filter.kind);
    }
    if (filter.exportedOnly) {
      symbols = symbols.filter(s => s.is_exported);
    }
    if (filter.filePath) {
      symbols = symbols.filter(s => s.location.file_path === filter.filePath);
    }
    const modulePath = filter.modulePath;
    if (modulePath) {
      symbols = symbols.filter(s => s.location.file_path.startsWith(modulePath));
    }
    if (filter.limit !== undefined) {
      symbols = symbols.slice(0, filter.limit);
    }
    return symbols;
  }

  async mostCalledFunctions(limit: number): Promise<SymbolMetric[]> {
    const refs = this.store.refsFindAll().filter(r => r.kind === 'call');
    const counts = new Map<SymbolId, number>();
    for (const r of refs) {
      counts.set(r.target_symbol_id, (counts.get(r.target_symbol_id) ?? 0) + 1);
    }
    return this.rankByMetric(counts, limit);
  }

  async mostImpactfulSymbols(limit: number): Promise<SymbolMetric[]> {
    const refs = this.store.refsFindAll().filter(r => r.kind === 'call');
    const callers = new Map<SymbolId, Set<SymbolId>>();
    for (const r of refs) {
      const set = callers.get(r.target_symbol_id) ?? new Set<SymbolId>();
      set.add(r.source_symbol_id);
      callers.set(r.target_symbol_id, set);
    }
    const metrics = new Map<SymbolId, number>();
    for (const [target, set] of callers) {
      metrics.set(target, set.size);
    }
    return this.rankByMetric(metrics, limit);
  }

  async unusedExports(limit: number): Promise<Symbol[]> {
    const allRefs = this.store.refsFindAll();
    const referenced = new Set(allRefs.map(r => r.target_symbol_id));
    const symbols = this.store.symbolsFindAll().filter(s => s.is_exported && !referenced.has(s.id));
    return symbols.slice(0, limit);
  }

  async mostCoupledModules(limit: number): Promise<ModuleCoupling[]> {
    const refs = this.store.refsFindAll();
    const symbols = this.symbolMap();
    const pairCounts = new Map<string, { moduleA: string; moduleB: string; count: number }>();

    for (const r of refs) {
      const source = symbols.get(r.source_symbol_id);
      const target = symbols.get(r.target_symbol_id);
      if (!source || !target) continue;

      const a = source.location.file_path;
      const b = target.location.file_path;
      if (a === b) continue;

      const sorted = [a, b].sort();
      const key = sorted.join('|');
      const entry = pairCounts.get(key) ?? { moduleA: sorted[0]!, moduleB: sorted[1]!, count: 0 };
      entry.count++;
      pairCounts.set(key, entry);
    }

    return Array.from(pairCounts.values())
      .map(e => ({ moduleA: e.moduleA, moduleB: e.moduleB, referenceCount: e.count }))
      .sort((a, b) => b.referenceCount - a.referenceCount)
      .slice(0, limit);
  }

  async longestCallChains(limit: number): Promise<CallChain[]> {
    const symbols = this.symbolMap();
    const outgoing = new Map<SymbolId, SymbolId[]>();
    const refs = this.store.refsFindAll().filter(r => r.kind === 'call');

    for (const r of refs) {
      const arr = outgoing.get(r.source_symbol_id) ?? [];
      arr.push(r.target_symbol_id);
      outgoing.set(r.source_symbol_id, arr);
    }

    const chains: CallChain[] = [];
    const seen = new Set<string>();

    // 从真正的调用根节点开始，避免产生大量子链
    const incoming = new Set<SymbolId>();
    for (const r of refs) incoming.add(r.target_symbol_id);
    let roots = Array.from(symbols.keys()).filter(id => !incoming.has(id));
    if (roots.length === 0) {
      roots = Array.from(symbols.keys());
    }

    for (const start of roots) {
      this.dfsChain(start, outgoing, symbols, new Set<SymbolId>(), [], chains, seen);
    }

    return chains
      .sort((a, b) => b.depth - a.depth)
      .slice(0, limit);
  }

  private dfsChain(
    current: SymbolId,
    outgoing: Map<SymbolId, SymbolId[]>,
    symbols: Map<SymbolId, Symbol>,
    visited: Set<SymbolId>,
    path: SymbolId[],
    chains: CallChain[],
    seen: Set<string>,
  ): void {
    if (visited.has(current)) {
      return;
    }

    visited.add(current);
    path.push(current);

    const nexts = outgoing.get(current) ?? [];
    if (nexts.length === 0 && path.length > 1) {
      const key = path.join('->');
      if (!seen.has(key)) {
        seen.add(key);
        chains.push({
          chain: path.map(id => symbols.get(id)).filter((s): s is Symbol => s !== undefined),
          depth: path.length,
        });
      }
    }

    for (const next of nexts) {
      this.dfsChain(next, outgoing, symbols, visited, path, chains, seen);
    }

    path.pop();
    visited.delete(current);
  }

  async findEntryPoints(): Promise<Symbol[]> {
    const refs = this.store.refsFindAll().filter(r => r.kind === 'call');
    const called = new Set(refs.map(r => r.target_symbol_id));
    return this.store.symbolsFindAll().filter(s => s.is_exported && !called.has(s.id));
  }

  async listTodoComments(): Promise<TodoComment[]> {
    const results: TodoComment[] = [];
    const files = this.listSourceFiles(this.projectPath);

    for (const filePath of files) {
      const text = readFileSync(filePath, 'utf-8');
      const relPath = relative(this.projectPath, filePath);
      const lines = text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/\/\/\s*(TODO|FIXME|HACK)[\s:]*(.*)/i);
        if (match) {
          results.push({
            filePath: relPath,
            line: i + 1,
            text: (match[2] ?? '').trim(),
            kind: match[1].toUpperCase() as TodoComment['kind'],
          });
        }
      }
    }

    return results;
  }

  async mostChangedFiles(
    timeRange: { from: Date; to: Date } | undefined,
    limit: number,
  ): Promise<{ filePath: string; changeCount: number }[]> {
    try {
      const since = timeRange?.from ? `--since=${timeRange.from.toISOString()}` : '';
      const until = timeRange?.to ? `--until=${timeRange.to.toISOString()}` : '';
      const output = execSync(
        `git log --name-only --pretty=format: ${since} ${until}`.trim(),
        { cwd: this.projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      );

      const counts = new Map<string, number>();
      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.includes(' ')) continue;
        if (!SOURCE_EXTENSIONS.has(extname(trimmed))) continue;
        counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
      }

      return Array.from(counts.entries())
        .map(([filePath, changeCount]) => ({ filePath, changeCount }))
        .sort((a, b) => b.changeCount - a.changeCount)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  async complexityScores(limit: number): Promise<ComplexityScore[]> {
    const symbols = this.store.symbolsFindAll();
    const refs = this.store.refsFindAll();
    const outgoingCounts = new Map<SymbolId, number>();
    const incomingCounts = new Map<SymbolId, number>();

    for (const r of refs) {
      outgoingCounts.set(r.source_symbol_id, (outgoingCounts.get(r.source_symbol_id) ?? 0) + 1);
      incomingCounts.set(r.target_symbol_id, (incomingCounts.get(r.target_symbol_id) ?? 0) + 1);
    }

    const scores: ComplexityScore[] = symbols.map(s => {
      let score = 0;
      const factors: string[] = [];

      const paramCount = this.estimateParamCount(s.signature);
      if (paramCount > 0) {
        score += paramCount * 2;
        factors.push(`${paramCount} params`);
      }

      const out = outgoingCounts.get(s.id) ?? 0;
      if (out > 0) {
        score += out;
        factors.push(`${out} outgoing refs`);
      }

      const inc = incomingCounts.get(s.id) ?? 0;
      if (inc > 0) {
        score += inc;
        factors.push(`${inc} incoming refs`);
      }

      if (s.is_exported) {
        score += 3;
        factors.push('exported');
      }

      return { symbol: s, score, factors };
    });

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async typeRelationships(symbolId: SymbolId, kind: RelationshipKind): Promise<TypeRelationship[]> {
    const kindFilter: Record<RelationshipKind, ReferenceKind> = {
      subclass: 'inheritance',
      implementation: 'interface_implements',
      type_use: 'type_use',
    };
    const refs = this.store.refsFindByTarget(symbolId).filter(r => r.kind === kindFilter[kind]);
    const symbols = this.symbolMap();
    return refs
      .map(r => {
        const sym = symbols.get(r.source_symbol_id);
        return sym ? { kind, symbol: sym } : null;
      })
      .filter((r): r is TypeRelationship => r !== null);
  }

  private estimateParamCount(signature?: string): number {
    if (!signature) return 0;
    const match = signature.match(/\(([^)]*)\)/);
    if (!match) return 0;
    const inner = match[1]!.trim();
    if (inner === '') return 0;
    return inner.split(',').length;
  }

  private rankByMetric(metrics: Map<SymbolId, number>, limit: number): SymbolMetric[] {
    const symbolMap = this.symbolMap();
    return Array.from(metrics.entries())
      .map(([id, metric]) => ({ symbol: symbolMap.get(id)!, metric }))
      .filter(s => s.symbol !== undefined)
      .sort((a, b) => b.metric - a.metric)
      .slice(0, limit);
  }

  private symbolMap(): Map<SymbolId, Symbol> {
    const symbols = this.store.symbolsFindAll();
    const map = new Map<SymbolId, Symbol>();
    for (const s of symbols) {
      map.set(s.id, s);
    }
    return map;
  }

  private listSourceFiles(dir: string): string[] {
    const results: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const fullPath = join(dir, entry);
      let st;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        results.push(...this.listSourceFiles(fullPath));
      } else if (st.isFile() && SOURCE_EXTENSIONS.has(extname(fullPath))) {
        results.push(fullPath);
      }
    }

    return results;
  }
}
