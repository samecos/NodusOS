// ============================================================
// CodeIntelligence 实现 — tree-sitter + KnowledgeStore
// ============================================================

import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type {
  Symbol, Language, Reference, CallGraph, CallGraphNode, CallGraphEdge,
  IndexStatus, SymbolKind, ReferenceKind, SymbolId, CallDirection,
  RiskLevel,
} from '../common/types.js';
import type { LanguageParser } from './language-parser.js';
import type {
  CodeIntelligence, IndexReport, FileIndexResult,
  ImpactReport, ChangeRecord, QueryIntent, QueryResult, ChangeScope,
} from './code-intelligence.js';
import type { GitIntelligence } from '../git-intel/git-intelligence.js';
import { TypeScriptParser } from './parsers/typescript-parser.js';
import { PythonParser } from './parsers/python-parser.js';

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
        const symbols = parser.parseSymbols(source, file);
        const refs = parser.parseReferences(source, symbols);
        const callEdges = parser.parseCallEdges(source, symbols);

        // 填充引用中的 source 信息
        const symbolMap = new Map(symbols.map(s => [s.name, s]));
        for (const ref of refs) {
          // 从调用边推断引用方
          for (const edge of callEdges) {
            if (edge.callee_name === symbolMap.get(ref.target_symbol_id.split(':').pop() ?? '')?.name) {
              const caller = allSymbols.find(s => s.name === edge.caller_name)
                ?? symbols.find(s => s.name === edge.caller_name);
              if (caller) ref.source_symbol_id = caller.id;
            }
          }
        }

        this.store.symbolsUpsert(symbols);
        this.store.refsUpsert(refs);

        allSymbols.push(...symbols);
        allRefs.push(...refs);
        report.filesIndexed++;
        report.symbolsFound += symbols.length;
        report.referencesFound += refs.length;
      } catch (err) {
        report.filesFailed++;
        report.errors.push({ file, error: String(err) });
      }
    }

    // 构建全局调用图并存储
    const callgraph = this.buildGlobalCallGraph(allSymbols, allRefs);
    if (callgraph) {
      this.store.callgraphStore(callgraph);
    }

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
    if (!lang) throw new Error(`Unsupported file: ${filePath}`);

    const parser = this.parsers.get(lang);
    if (!parser) throw new Error(`No parser for: ${lang}`);

    // 删除旧数据
    const removed = this.store.symbolsRemove(filePath);
    this.store.refsRemoveForFile(filePath);

    // 重新解析
    const source = readFileSync(filePath, 'utf-8');
    const symbols = parser.parseSymbols(source, filePath);
    const refs = parser.parseReferences(source, symbols);

    // 存储新数据
    const added = this.store.symbolsUpsert(symbols);
    const refsAdded = this.store.refsUpsert(refs);

    // 重建调用图
    this.store.callgraphRebuildForFile(filePath);

    return {
      symbolsAdded: added,
      symbolsRemoved: removed,
      referencesUpdated: refsAdded,
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

  async callGraph(symbolId: SymbolId, direction: CallDirection, maxDepth: number): Promise<CallGraph | null> {
    return this.store.callgraphGet(symbolId, direction, maxDepth);
  }

  async symbolsInFile(filePath: string): Promise<Symbol[]> {
    return this.store.symbolsFindByFile(filePath);
  }

  async impactAnalysis(symbolId: SymbolId): Promise<ImpactReport | null> {
    const allRefs = this.store.refsFindByTarget(symbolId);
    if (allRefs.length === 0) return null;

    const callerIds = [...new Set(allRefs.map(r => r.source_symbol_id).filter(Boolean))];
    const affectedFiles = [...new Set(allRefs.map(r => r.location.file_path))];

    // 获取直接调用方符号
    const directCallers: Symbol[] = [];
    for (const id of callerIds) {
      const syms = this.store.symbolsFindByName(id, undefined, 1);
      if (syms[0]) directCallers.push(syms[0]);
    }

    const riskLevel: RiskLevel = affectedFiles.length > 15 ? 'high'
      : affectedFiles.length > 5 ? 'medium' : 'low';

    const rootSymbol = this.store.symbolsFindByName(symbolId, undefined, 1)[0];

    return {
      symbol: rootSymbol ?? { id: symbolId, name: symbolId, kind: 'function', language: 'typescript',
        location: { file_path: '', line_start: 0, line_end: 0, col_start: 0, col_end: 0 },
        is_exported: false },
      directCallers,
      transitiveCallers: [],
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
          // 获取该 commit 涉及的符号
          const fileSyms = this.store.symbolsFindByFile(file);
          records.push({
            commitHash: commit.hash,
            commitMessage: commit.message,
            author: commit.author,
            timestamp: commit.timestamp,
            changedSymbols: fileSyms,
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
      default:
        return { kind: 'symbol_list', symbols: [] };
    }
  }

  // ========== 内部辅助 ==========

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

  private detectLanguage(filePath: string): Language | null {
    const ext = extname(filePath);
    if (['.ts', '.tsx'].includes(ext)) return 'typescript';
    if (['.js', '.jsx'].includes(ext)) return 'javascript';
    if (ext === '.py') return 'python';
    return null;
  }

  private buildGlobalCallGraph(
    symbols: Symbol[],
    refs: Reference[],
  ): CallGraph | null {
    if (symbols.length === 0) return null;

    const symbolMap = new Map(symbols.map(s => [s.id, s]));
    const callRefs = refs.filter(r => r.kind === 'call');

    const nodeSet = new Set<SymbolId>();
    const edges: CallGraphEdge[] = [];

    for (const ref of callRefs) {
      if (ref.source_symbol_id && ref.target_symbol_id) {
        nodeSet.add(ref.source_symbol_id);
        nodeSet.add(ref.target_symbol_id);
        edges.push({ from: ref.source_symbol_id, to: ref.target_symbol_id, kind: ref.kind as ReferenceKind });
      }
    }

    const nodes: CallGraphNode[] = [...nodeSet].map(id => {
      const sym = symbolMap.get(id);
      return {
        symbol_id: id,
        symbol_name: sym?.name ?? id,
        file_path: sym?.location.file_path ?? '',
        line: sym?.location.line_start ?? 0,
        depth: 0,
      };
    });

    return {
      root_symbol_id: nodes[0]?.symbol_id ?? '',
      direction: 'both',
      max_depth: 5,
      nodes,
      edges,
    };
  }
}
