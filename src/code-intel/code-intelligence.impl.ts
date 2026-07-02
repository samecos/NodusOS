// ============================================================
// CodeIntelligence 实现 — tree-sitter + KnowledgeStore
// ============================================================

import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, extname, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type {
  Symbol, Language, Reference, CallGraph, CallGraphNode, CallGraphEdge,
  IndexStatus, SymbolKind, ReferenceKind, SymbolId, CallDirection,
  RiskLevel, ImportBinding,
} from '../common/types.js';
import type { LanguageParser } from './language-parser.js';
import { CodeIntelError } from '../common/errors.js';
import type {
  CodeIntelligence, IndexReport, FileIndexResult,
  ImpactReport, ChangeRecord, QueryIntent, QueryResult, ChangeScope, RelationshipKind,
} from './code-intelligence.js';
import type { GitIntelligence, DiffData } from '../git-intel/git-intelligence.js';
import { TypeScriptParser } from './parsers/typescript-parser.js';
import { PythonParser } from './parsers/python-parser.js';
import { DefaultCodeAnalytics } from './code-analytics.impl.js';
import { ModuleResolver } from './module-resolver.js';
import { ReferenceResolver } from './reference-resolver.js';

/** 默认排除的文件模式 */
const EXCLUDE_PATTERNS = [
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.next', '.nuxt', 'coverage', '.cache',
];

export class CodeIntelligenceImpl implements CodeIntelligence {
  private store: KnowledgeStore;
  private parsers: Map<Language, LanguageParser>;
  private projectRoot: string | null = null;
  private supportedExtensions: string[] = [];
  private gitIntel: GitIntelligence | null = null;
  private state: { kind: 'idle' | 'ready'; symbolCount: number; lastIndexed: string } = {
    kind: 'idle', symbolCount: 0, lastIndexed: '',
  };

  constructor(store: KnowledgeStore) {
    this.store = store;
    this.parsers = new Map();
    const tsParser = new TypeScriptParser();
    const pyParser = new PythonParser();
    this.parsers.set('typescript', tsParser);
    this.parsers.set('javascript', tsParser);
    this.parsers.set('python', pyParser);
  }

  /** 注入 GitIntelligence 依赖（用于 changeHistory） */
  setGitIntel(git: GitIntelligence): void {
    this.gitIntel = git;
  }

  // ========== 索引管理 ==========

  async indexProject(projectRoot: string, languages: Language[]): Promise<IndexReport> {
    this.projectRoot = projectRoot;
    const startTime = Date.now();
    const report: IndexReport = {
      filesIndexed: 0, filesFailed: 0,
      symbolsFound: 0, referencesFound: 0,
      durationMs: 0, errors: [],
    };

    // 收集所有匹配语言扩展名的文件
    const extensions = new Set<string>();
    for (const lang of languages) {
      const parser = this.parsers.get(lang);
      if (parser) {
        for (const ext of parser.fileExtensions()) extensions.add(ext);
      }
    }
    this.supportedExtensions = [...extensions];

    const files = await this.collectFiles(projectRoot);
    const allSymbols: Symbol[] = [];
    const allRefs: Reference[] = [];

    for (const file of files) {
      try {
        const lang = this.detectLanguage(file);
        if (!lang || !languages.includes(lang)) continue;

        const parser = this.parsers.get(lang);
        if (!parser) continue;

        const source = readFileSync(file, 'utf-8');
        const checksum = this.computeChecksum(source);
        const existing = this.store.fileStateGet(file);

        let symbols: Symbol[];
        let refs: Reference[];
        let isSkipped = false;

        if (existing && existing.checksum === checksum && !existing.error) {
          // 文件未变化：从 store 复用已有解析结果
          symbols = this.store.symbolsFindByFile(file);
          refs = this.store.refsFindByFile(file);
          isSkipped = true;
        } else {
          // 文件变化或首次索引：删除旧数据并重新解析
          this.store.symbolsRemove(file);
          this.store.refsRemoveForFile(file);

          symbols = parser.parseSymbols(source, file);
          refs = parser.parseReferences(source, symbols);

          // parser 无法从空 symbols 推断文件路径时，显式修正
          for (const ref of refs) {
            if (ref.location.file_path !== file) {
              ref.location.file_path = file;
            }
          }

          this.enrichRefsWithSource(refs, [...allSymbols, ...symbols]);

          this.store.symbolsUpsert(symbols);
          this.store.refsUpsert(refs);

          this.store.fileStateUpsert({
            file_path: file,
            checksum,
            symbol_count: symbols.length,
            indexed_at: new Date().toISOString(),
          });
        }

        allSymbols.push(...symbols);
        allRefs.push(...refs);
        report.filesIndexed++;
        report.symbolsFound += symbols.length;
        report.referencesFound += refs.length;
      } catch (err) {
        report.filesFailed++;
        report.errors.push({ file, error: String(err) });

        // 记录失败状态，避免在文件未改变前反复重试
        try {
          const source = readFileSync(file, 'utf-8');
          this.store.fileStateUpsert({
            file_path: file,
            checksum: this.computeChecksum(source),
            symbol_count: 0,
            indexed_at: new Date().toISOString(),
            error: String(err),
          });
        } catch {
          // 如果连读取都失败，只记录错误
          this.store.fileStateUpsert({
            file_path: file,
            checksum: '',
            symbol_count: 0,
            indexed_at: new Date().toISOString(),
            error: String(err),
          });
        }
      }
    }

    // 第二遍：跨文件引用解析
    const moduleResolver = new ModuleResolver(projectRoot);
    const referenceResolver = new ReferenceResolver(moduleResolver, this.store);

    // 收集每个文件的 import bindings
    const bindingsByFile = new Map<string, ImportBinding[]>();
    for (const file of files) {
      const lang = this.detectLanguage(file);
      if (!lang || !languages.includes(lang)) continue;
      const parser = this.parsers.get(lang);
      if (!(parser instanceof TypeScriptParser)) continue;
      try {
        const source = readFileSync(file, 'utf-8');
        const bindings = parser.parseImportBindings(source, file);
        bindingsByFile.set(file, bindings);
      } catch {
        bindingsByFile.set(file, []);
      }
    }

    // 解析引用目标
    let resolvedCount = 0;
    for (const [file, bindings] of bindingsByFile) {
      const refs = this.store.refsFindByFile(file);
      const before = refs.filter(r => r.target_symbol_id.startsWith('external:') || r.target_symbol_id.startsWith('unknown:')).length;
      referenceResolver.resolveFileRefs(file, refs, bindings);
      const after = refs.filter(r => r.target_symbol_id.startsWith('external:') || r.target_symbol_id.startsWith('unknown:')).length;
      resolvedCount += before - after;
      this.store.refsUpsert(refs);
    }

    report.referencesFound = this.store.refsFindAll().length;

    report.durationMs = Date.now() - startTime;
    this.state = {
      kind: 'ready',
      symbolCount: report.symbolsFound,
      lastIndexed: new Date().toISOString(),
    };

    return report;
  }

  async indexFile(filePath: string): Promise<FileIndexResult> {
    const startTime = Date.now();
    const lang = this.detectLanguage(filePath);
    if (!lang) throw new CodeIntelError(CodeIntelError.UNSUPPORTED_FILE, `Unsupported file: ${filePath}`);

    const parser = this.parsers.get(lang);
    if (!parser) throw new CodeIntelError(CodeIntelError.NO_PARSER, `No parser for: ${lang}`);

    const source = readFileSync(filePath, 'utf-8');
    const checksum = this.computeChecksum(source);

    // 增量索引：checksum 未变化且上次无错误，直接跳过
    const existing = this.store.fileStateGet(filePath);
    if (existing && existing.checksum === checksum && !existing.error) {
      return {
        symbolsAdded: 0,
        symbolsRemoved: 0,
        referencesUpdated: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // 删除旧数据
    const removed = this.store.symbolsRemove(filePath);
    this.store.refsRemoveForFile(filePath);

    // 重新解析
    const symbols = parser.parseSymbols(source, filePath);
    const refs = parser.parseReferences(source, symbols);

    // parser 无法从空 symbols 推断文件路径时，显式修正
    for (const ref of refs) {
      if (ref.location.file_path !== filePath) {
        ref.location.file_path = filePath;
      }
    }

    this.enrichRefsWithSource(refs, symbols);

    // 存储新数据
    const added = this.store.symbolsUpsert(symbols);
    const refsAdded = this.store.refsUpsert(refs);

    // 重建调用图
    this.store.callgraphRebuildForFile(filePath);

    // 更新文件索引状态
    this.store.fileStateUpsert({
      file_path: filePath,
      checksum,
      symbol_count: symbols.length,
      indexed_at: new Date().toISOString(),
    });

    // 解析当前文件跨文件引用
    let referencesUpdated = refsAdded;
    if (parser instanceof TypeScriptParser) {
      const bindings = parser.parseImportBindings(source, filePath);
      const resolver = new ReferenceResolver(new ModuleResolver(this.projectRoot ?? dirname(filePath)), this.store);
      const fileRefs = this.store.refsFindByFile(filePath);
      const before = fileRefs.map(r => r.target_symbol_id);
      resolver.resolveFileRefs(filePath, fileRefs, bindings);
      const changed = fileRefs.filter((r, i) => r.target_symbol_id !== before[i]).length;
      this.store.refsUpsert(fileRefs);
      referencesUpdated = changed;
    }

    return {
      symbolsAdded: added,
      symbolsRemoved: removed,
      referencesUpdated,
      durationMs: Date.now() - startTime,
    };
  }

  indexStatus(): IndexStatus {
    if (this.state.kind === 'idle') return { kind: 'idle' };
    return {
      kind: 'ready',
      symbol_count: this.state.symbolCount,
      last_indexed: this.state.lastIndexed,
    };
  }

  // ========== 查询 ==========

  async findSymbol(name: string, kind?: SymbolKind, fileFilter?: string, limit = 10): Promise<Symbol[]> {
    return this.store.symbolsFindByName(name, kind, limit);
  }

  async findReferences(symbolId: SymbolId): Promise<Reference[]> {
    return this.store.refsFindByTarget(symbolId);
  }

  async findSubclasses(symbolId: SymbolId): Promise<Symbol[]> {
    const refs = this.store.refsFindByTarget(symbolId).filter(r => r.kind === 'inheritance');
    return this.symbolsFromRefs(refs);
  }

  async findImplementations(symbolId: SymbolId): Promise<Symbol[]> {
    const refs = this.store.refsFindByTarget(symbolId).filter(r => r.kind === 'interface_implements');
    return this.symbolsFromRefs(refs);
  }

  async findTypeUses(symbolId: SymbolId): Promise<Symbol[]> {
    const refs = this.store.refsFindByTarget(symbolId).filter(r => r.kind === 'type_use');
    return this.symbolsFromRefs(refs);
  }

  async callGraph(symbolId: SymbolId, direction: CallDirection, maxDepth: number): Promise<CallGraph | null> {
    const root = this.store.symbolsFindById(symbolId);
    if (!root) return null;

    // 优先读取调用图缓存
    const cached = this.store.callgraphGet(symbolId, direction, maxDepth);
    if (cached) return cached;

    const nodeIds = new Set<SymbolId>([symbolId]);
    const edgeSet = new Set<string>();
    const edges: CallGraphEdge[] = [];
    const visited = new Map<SymbolId, number>();
    const queue: Array<{ id: SymbolId; depth: number }> = [{ id: symbolId, depth: 0 }];
    visited.set(symbolId, 0);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      if (direction === 'callees' || direction === 'both') {
        const outgoing = this.store.refsFindBySource(id).filter(r => r.kind === 'call');
        for (const ref of outgoing) {
          const targetId = ref.target_symbol_id;
          if (!targetId) continue;
          nodeIds.add(targetId);
          const edgeKey = `${id}|${targetId}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({ from: id, to: targetId, kind: ref.kind });
          }
          if (!visited.has(targetId) || visited.get(targetId)! > depth + 1) {
            visited.set(targetId, depth + 1);
            queue.push({ id: targetId, depth: depth + 1 });
          }
        }
      }

      if (direction === 'callers' || direction === 'both') {
        const incoming = this.store.refsFindByTarget(id).filter(r => r.kind === 'call');
        for (const ref of incoming) {
          const sourceId = ref.source_symbol_id;
          if (!sourceId) continue;
          nodeIds.add(sourceId);
          const edgeKey = `${sourceId}|${id}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({ from: sourceId, to: id, kind: ref.kind });
          }
          if (!visited.has(sourceId) || visited.get(sourceId)! > depth + 1) {
            visited.set(sourceId, depth + 1);
            queue.push({ id: sourceId, depth: depth + 1 });
          }
        }
      }
    }

    const nodes: CallGraphNode[] = [];
    for (const id of nodeIds) {
      const sym = this.store.symbolsFindById(id);
      nodes.push({
        symbol_id: id,
        symbol_name: sym?.name ?? id,
        file_path: sym?.location.file_path ?? '',
        line: sym?.location.line_start ?? 0,
        depth: visited.get(id) ?? 0,
      });
    }

    const graph: CallGraph = {
      root_symbol_id: symbolId,
      direction,
      max_depth: maxDepth,
      nodes,
      edges,
    };

    this.store.callgraphStore(graph);
    return graph;
  }

  async symbolsInFile(filePath: string): Promise<Symbol[]> {
    return this.store.symbolsFindByFile(filePath);
  }

  async impactAnalysis(symbolId: SymbolId): Promise<ImpactReport | null> {
    const directRefs = this.store.refsFindByTarget(symbolId);
    if (directRefs.length === 0) return null;

    const directCallerIds = [...new Set(directRefs.map(r => r.source_symbol_id).filter(Boolean))];

    // BFS 收集传递调用方
    const transitiveCallerIds = new Set<SymbolId>();
    const visited = new Set<SymbolId>([symbolId]);
    const queue = [...directCallerIds];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const refs = this.store.refsFindByTarget(current);
      const callers = refs.map(r => r.source_symbol_id).filter((id): id is SymbolId => Boolean(id));
      for (const caller of callers) {
        if (!directCallerIds.includes(caller) && caller !== symbolId) {
          transitiveCallerIds.add(caller);
        }
        queue.push(caller);
      }
    }

    // 收集受影响文件
    const allCallerIds = [...directCallerIds, ...transitiveCallerIds];
    const affectedFiles = [...new Set([
      ...directRefs.map(r => r.location.file_path),
      ...allCallerIds.flatMap(id => this.store.refsFindByTarget(id).map(r => r.location.file_path)),
    ])];

    const symbolById = (id: SymbolId): Symbol | undefined => this.store.symbolsFindById(id);

    const directCallers = directCallerIds.map(symbolById).filter((s): s is Symbol => s !== undefined);
    const transitiveCallers = [...transitiveCallerIds].map(symbolById).filter((s): s is Symbol => s !== undefined);

    const riskLevel: RiskLevel = affectedFiles.length > 15 ? 'high'
      : affectedFiles.length > 5 ? 'medium' : 'low';

    const rootSymbol = this.store.symbolsFindById(symbolId);

    return {
      symbol: rootSymbol ?? {
        id: symbolId, name: symbolId, kind: 'function', language: 'typescript',
        location: { file_path: '', line_start: 0, line_end: 0, col_start: 0, col_end: 0 },
        is_exported: false,
      },
      directCallers,
      transitiveCallers,
      affectedFiles,
      riskLevel,
    };
  }

  async changeHistory(
    scope: ChangeScope,
    timeRange?: { from: Date; to: Date },
    git?: GitIntelligence,
  ): Promise<ChangeRecord[]> {
    const gitImpl = git ?? this.gitIntel;
    if (!gitImpl) return [];
    if (!this.projectRoot) return [];

    // 从 scope 确定要查询的文件列表
    let files: string[];
    if (scope.kind === 'file') {
      files = [scope.path];
    } else if (scope.kind === 'directory') {
      // 从 KnowledgeStore 查找该目录下的所有文件
      const syms = this.store.symbolsFindByModule(scope.path);
      files = [...new Set(syms.map(s => s.location.file_path))];
    } else {
      // scope.kind === 'symbol' — 找到符号所在的文件
      const refs = this.store.refsFindByTarget(scope.id);
      files = [...new Set(refs.map(r => r.location.file_path))];
    }

    if (files.length === 0) return [];

    const records: ChangeRecord[] = [];

    for (const file of files) {
      try {
        const commits = await gitImpl.log(
          this.projectRoot,
          { kind: 'file', path: file },
          timeRange,
          undefined,
          20,
        );

        for (const commit of commits) {
          let changedSymbols: Symbol[] = [];
          try {
            const diff = await gitImpl.diff(this.projectRoot, commit.hash);
            changedSymbols = this.symbolsFromDiff(diff);
          } catch {
            // diff 解析失败时降级为返回该文件所有符号
            changedSymbols = this.store.symbolsFindByFile(file);
          }

          records.push({
            commitHash: commit.hash,
            commitMessage: commit.message,
            author: commit.author,
            timestamp: commit.timestamp,
            changedSymbols,
            diffSummary: `${commit.filesChanged} files, +${commit.insertions} -${commit.deletions}`,
          });
        }
      } catch {
        // 跳过无法查询的文件
      }
    }

    // 按时间倒序，去重
    const seen = new Set<string>();
    return records
      .filter(r => {
        const key = r.commitHash;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  private symbolsFromDiff(diff: DiffData): Symbol[] {
    const changedSymbols: Symbol[] = [];
    const seenIds = new Set<SymbolId>();

    for (const fileDiff of diff.files) {
      const changedLines = new Set<number>();
      for (const hunk of fileDiff.hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'added' && line.newLine) changedLines.add(line.newLine);
          if (line.type === 'removed' && line.oldLine) changedLines.add(line.oldLine);
        }
      }
      if (changedLines.size === 0) continue;

      const filePath = join(this.projectRoot!, fileDiff.path);
      const syms = this.store.symbolsFindByFile(filePath);
      for (const sym of syms) {
        if (seenIds.has(sym.id)) continue;
        for (const line of changedLines) {
          if (sym.location.line_start <= line && sym.location.line_end >= line) {
            changedSymbols.push(sym);
            seenIds.add(sym.id);
            break;
          }
        }
      }
    }

    return changedSymbols;
  }

  async query(intent: QueryIntent): Promise<QueryResult> {
    const { intentType, entities } = intent;

    switch (intentType) {
      case 'find_definition': {
        const syms = await this.findSymbol(entities.symbolName ?? '');
        return { kind: 'symbol_list', symbols: syms };
      }
      case 'find_references': {
        const syms = await this.findSymbol(entities.symbolName ?? '', undefined, undefined, 1);
        if (!syms[0]) return { kind: 'reference_list', references: [] };
        const refs = await this.findReferences(syms[0].id);
        return { kind: 'reference_list', references: refs };
      }
      case 'call_graph': {
        const syms = await this.findSymbol(entities.symbolName ?? '', undefined, undefined, 1);
        if (!syms[0]) return { kind: 'call_graph', graph: { root_symbol_id: '', direction: 'both', max_depth: 3, nodes: [], edges: [] } };
        const graph = await this.callGraph(syms[0].id, 'both', 3);
        return { kind: 'call_graph', graph: graph ?? { root_symbol_id: syms[0].id, direction: 'both', max_depth: 3, nodes: [], edges: [] } };
      }
      case 'impact_analysis': {
        const syms = await this.findSymbol(entities.symbolName ?? '', undefined, undefined, 1);
        if (!syms[0]) return { kind: 'impact_report', report: { symbol: { id: '', name: '', kind: 'function', language: 'typescript', location: { file_path: '', line_start: 0, line_end: 0, col_start: 0, col_end: 0 }, is_exported: false }, directCallers: [], transitiveCallers: [], affectedFiles: [], riskLevel: 'low' } };
        const report = await this.impactAnalysis(syms[0].id);
        if (!report) return { kind: 'impact_report', report: { symbol: syms[0], directCallers: [], transitiveCallers: [], affectedFiles: [], riskLevel: 'low' } };
        return { kind: 'impact_report', report };
      }
      case 'symbol_overview': {
        const syms = await this.symbolsInFile(entities.filePath ?? '');
        return { kind: 'symbol_overview', symbols: syms };
      }
      case 'change_history': {
        const scope: ChangeScope = entities.moduleName
          ? { kind: 'directory', path: entities.moduleName }
          : entities.filePath
            ? { kind: 'file', path: entities.filePath }
            : { kind: 'directory', path: '.' };
        const records = await this.changeHistory(scope, entities.timeRange);
        return { kind: 'change_history', records };
      }
      case 'list_symbols': {
        const syms = await this.analytics().listSymbols(entities.filter ?? {});
        return { kind: 'symbol_list', symbols: syms };
      }
      case 'stats': {
        const symbols = this.store.symbolsFindAll();
        const refs = this.store.refsFindAll();
        const files = new Set(symbols.map(s => s.location.file_path));
        return {
          kind: 'stats_report',
          stats: {
            totalSymbols: symbols.length,
            totalReferences: refs.length,
            exportedSymbols: symbols.filter(s => s.is_exported).length,
            filesIndexed: files.size,
          },
        };
      }
      case 'analytics': {
        return this.handleAnalyticsQuery(entities.subType);
      }
      case 'type_relationships': {
        const syms = await this.findSymbol(entities.symbolName ?? '', undefined, undefined, 1);
        if (!syms[0]) return { kind: 'type_relationship_list', root: { id: '', name: '', kind: 'interface', language: 'typescript', location: { file_path: '', line_start: 0, line_end: 0, col_start: 0, col_end: 0 }, is_exported: false }, relationships: [] };
        const root = syms[0];
        let related: Symbol[] = [];
        let relKind: RelationshipKind = 'type_use';
        switch (entities.relationshipKind) {
          case 'subclasses':
            related = await this.findSubclasses(root.id);
            relKind = 'subclass';
            break;
          case 'implementations':
            related = await this.findImplementations(root.id);
            relKind = 'implementation';
            break;
          case 'type_uses':
          default:
            related = await this.findTypeUses(root.id);
            relKind = 'type_use';
            break;
        }
        return {
          kind: 'type_relationship_list',
          root,
          relationships: related.map(s => ({ kind: relKind, symbol: s })),
        };
      }
      default:
        return { kind: 'symbol_list', symbols: [] };
    }
  }

  private analytics(): DefaultCodeAnalytics {
    return new DefaultCodeAnalytics(this.store, this.projectRoot ?? process.cwd());
  }

  private async handleAnalyticsQuery(subType: string | undefined): Promise<QueryResult> {
    const analytics = this.analytics();
    const limit = 10;

    switch (subType) {
      case 'most_impactful':
        return { kind: 'symbol_ranking', title: '影响范围最大的符号', metrics: await analytics.mostImpactfulSymbols(limit) };
      case 'unused_exports':
        return { kind: 'symbol_list', symbols: await analytics.unusedExports(limit) };
      case 'coupled_modules':
        return { kind: 'module_coupling', couplings: await analytics.mostCoupledModules(limit) };
      case 'longest_chains':
        return { kind: 'call_chain', chains: await analytics.longestCallChains(limit) };
      case 'entry_points':
        return { kind: 'symbol_list', symbols: await analytics.findEntryPoints() };
      case 'todos':
        return { kind: 'todo_list', comments: await analytics.listTodoComments() };
      case 'complexity': {
        const scores = await analytics.complexityScores(limit);
        return {
          kind: 'symbol_ranking',
          title: '复杂度最高的符号',
          metrics: scores.map(s => ({ symbol: s.symbol, metric: s.score, detail: s.factors.join(', ') })),
        };
      }
      case 'most_changed':
        return { kind: 'change_heat', files: await analytics.mostChangedFiles(undefined, limit) };
      case 'most_called':
      default:
        return { kind: 'symbol_ranking', title: '调用次数最多的函数', metrics: await analytics.mostCalledFunctions(limit) };
    }
  }

  // ========== 内部辅助 ==========

  private symbolsFromRefs(refs: Reference[]): Symbol[] {
    const seen = new Set<SymbolId>();
    const result: Symbol[] = [];
    const fileSymbols = new Map<string, Symbol[]>();

    for (const ref of refs) {
      let sourceId: SymbolId | undefined = ref.source_symbol_id || undefined;

      // parser 可能未填充 source_symbol_id，此时按引用所在位置推断其外围符号
      if (!sourceId) {
        let syms = fileSymbols.get(ref.location.file_path);
        if (!syms) {
          syms = this.store.symbolsFindByFile(ref.location.file_path);
          fileSymbols.set(ref.location.file_path, syms);
        }
        const enclosing = this.findEnclosingSymbol(ref.location.file_path, ref.location.line_start, syms);
        if (enclosing) sourceId = enclosing.id;
      }

      if (!sourceId || seen.has(sourceId)) continue;
      const sym = this.store.symbolsFindById(sourceId);
      if (sym) {
        seen.add(sourceId);
        result.push(sym);
      }
    }
    return result;
  }

  private async collectFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const extSet = new Set(this.supportedExtensions);

    async function walk(dir: string) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (EXCLUDE_PATTERNS.includes(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && extSet.has(extname(entry.name))) {
          files.push(fullPath);
        }
      }
    }

    await walk(root);
    return files;
  }

  private computeChecksum(source: string): string {
    return createHash('sha256').update(source).digest('hex');
  }

  private detectLanguage(filePath: string): Language | null {
    const ext = extname(filePath);
    if (['.ts', '.tsx'].includes(ext)) return 'typescript';
    if (['.js', '.jsx'].includes(ext)) return 'javascript';
    if (ext === '.py') return 'python';
    return null;
  }

  private findEnclosingSymbol(filePath: string, line: number, symbols: Symbol[]): Symbol | undefined {
    let best: Symbol | undefined;
    for (const sym of symbols) {
      if (sym.location.file_path !== filePath) continue;
      if (sym.location.line_start > line || sym.location.line_end < line) continue;
      // 优先选择函数/方法/类作为引用方，跳过变量/参数等局部声明
      if (sym.kind === 'variable' || sym.kind === 'parameter') continue;
      if (!best || sym.location.line_start > best.location.line_start) {
        best = sym;
      }
    }
    return best;
  }

  /** 填充引用中的 source_symbol_id：根据引用所在位置找到包含它的函数/方法/类 */
  private enrichRefsWithSource(refs: Reference[], symbols: Symbol[]): void {
    for (const ref of refs) {
      const enclosing = this.findEnclosingSymbol(ref.location.file_path, ref.location.line_start, symbols);
      if (enclosing) {
        ref.source_symbol_id = enclosing.id;
      }
    }
  }
}
