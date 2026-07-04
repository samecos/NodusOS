// ============================================================
// TerminalRenderer — 终端格式化输出
// ============================================================

import type { UIRenderer, Card, BreathLightState, HistoryItem, RecommendationItem } from './ui-renderer.js';
import type { QueryResult } from '../code-intel/code-intelligence.js';
import type { IntentError, QueryIntent } from '../intent/intent-engine.js';
import type { Symbol, Reference, ReferenceKind, CallGraph, CallGraphNode, ProjectMeta, Language } from '../common/types.js';
import type { ImpactReport, ChangeRecord, TypeRelationship } from '../code-intel/code-intelligence.js';
import type { SymbolMetric, ModuleCoupling, CallChain, TodoComment } from '../code-intel/code-analytics.js';
import { type NodusError, getDegradationSuggestion } from '../common/errors.js';
import { readFileSnippet, renderSnippet } from './code-snippet.js';

const BLUE = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function c(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

function indent(level: number): string {
  return '  '.repeat(level);
}

export class TerminalRenderer implements UIRenderer {
  render(result: QueryResult): string {
    switch (result.kind) {
      case 'symbol_list':
        return this.renderSymbolList(result.symbols);
      case 'reference_list':
        return this.renderReferenceList(result.references);
      case 'call_graph':
        return this.renderCallGraph(result.graph);
      case 'impact_report':
        return this.renderImpact(result.report);
      case 'change_history':
        return this.renderChangeHistory(result.records);
      case 'symbol_overview':
        return this.renderSymbolOverview(result.symbols);
      case 'symbol_ranking':
        return this.renderSymbolRanking(result.title, result.metrics);
      case 'module_coupling':
        return this.renderModuleCoupling(result.couplings);
      case 'call_chain':
        return this.renderCallChains(result.chains);
      case 'todo_list':
        return this.renderTodoList(result.comments);
      case 'stats_report':
        return this.renderStatsReport(result.stats);
      case 'change_heat':
        return this.renderChangeHeat(result.files);
      case 'type_relationship_list':
        return this.renderTypeRelationships(result.root, result.relationships);
      default:
        return JSON.stringify(result, null, 2);
    }
  }

  renderError(error: IntentError): string {
    switch (error.kind) {
      case 'empty_input':
        return c('请输入查询内容', DIM);
      case 'unparseable':
        return c(`未能理解: "${error.rawText}"\n请尝试换一种说法`, YELLOW);
      case 'ambiguous':
        return this.renderAmbiguous(error.candidates);
      case 'unsupported':
        return c(`暂不支持: ${error.intentType}`, YELLOW);
      default:
        return c('未知错误', RED);
    }
  }

  renderNotification(title: string, body: string): string {
    return `\n${c('▸ ' + title, BOLD)}\n${c(body, DIM)}\n`;
  }

  renderHistory(items: HistoryItem[]): string {
    if (items.length === 0) return c('\n暂无查询历史\n', DIM);

    let out = c(`\n最近 ${items.length} 条查询:\n`, BOLD);
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const time = item.timestamp.slice(11, 19); // HH:MM:SS
      const intent = item.intentType ?? c('未知', DIM);
      out += `\n  ${c(String(i + 1).padStart(2, ' '), YELLOW)}  ${c(time, DIM)}  ${c(intent, BLUE)}`;
      out += `\n      ${item.text}`;
    }
    return out + '\n';
  }

  renderRecommendations(items: RecommendationItem[]): string {
    if (items.length === 0) return c('\n暂无推荐，试试输入查询吧\n', DIM);

    let out = c('\n你可能想问:\n', BOLD);
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      out += `\n  ${c(String(i + 1), YELLOW)}  ${c(item.text, BOLD)}`;
      out += `\n     ${c(item.reason, DIM)}`;
    }
    out += `\n${c('输入序号即可执行推荐查询', DIM)}\n`;
    return out;
  }

  // ---- 卡片系统 ----

  private cards = new Map<string, Card>();

  createCard(
    id: string,
    title: string,
    data:
      | QueryResult
      | IntentError
      | ProjectMeta
      | QueryIntent[]
      | HistoryItem[]
      | RecommendationItem[]
      | { title: string; body: string }
      | { kind: 'error'; error: NodusError; module: string },
    ttlSeconds?: number,
  ): Card {
    const kind = this.inferCardKind(data);
    const card: Card = {
      id,
      kind,
      title,
      data,
      createdAt: new Date().toISOString(),
      ttlSeconds,
    };
    this.cards.set(id, card);
    return card;
  }

  dismissCard(id: string): void {
    this.cards.delete(id);
  }

  listCards(): Card[] {
    return [...this.cards.values()];
  }

  renderCard(card: Card): string {
    if ('kind' in card.data && typeof card.data.kind === 'string') {
      if (card.data.kind === 'error') {
        return this.renderNodusErrorCard(card.data.error, card.data.module);
      }
      if (card.data.kind === 'symbol_list' || card.data.kind === 'reference_list' ||
          card.data.kind === 'call_graph' || card.data.kind === 'impact_report' ||
          card.data.kind === 'change_history' || card.data.kind === 'symbol_overview' ||
          card.data.kind === 'symbol_ranking' || card.data.kind === 'module_coupling' ||
          card.data.kind === 'call_chain' || card.data.kind === 'todo_list' ||
          card.data.kind === 'stats_report' || card.data.kind === 'change_heat' ||
          card.data.kind === 'type_relationship_list') {
        return this.render(card.data as QueryResult);
      }
      if (card.data.kind === 'empty_input' || card.data.kind === 'unparseable' ||
          card.data.kind === 'ambiguous' || card.data.kind === 'unsupported') {
        return this.renderError(card.data as IntentError);
      }
    }
    // HistoryItem[] 或 RecommendationItem[] — 通过 title 推断
    if (card.kind === 'history_list') {
      return this.renderHistory(card.data as HistoryItem[]);
    }
    if (card.kind === 'recommendation_list') {
      return this.renderRecommendations(card.data as RecommendationItem[]);
    }
    if (Array.isArray(card.data) && card.data.length > 0 && 'intentType' in card.data[0]) {
      return this.renderAmbiguous(card.data as QueryIntent[]);
    }
    if ('root_path' in card.data) {
      return this.renderNotification(card.title, `Project: ${(card.data as ProjectMeta).name}`);
    }
    if ('title' in card.data && 'body' in card.data) {
      const n = card.data as { title: string; body: string };
      return this.renderNotification(n.title, n.body);
    }
    return this.renderNotification(card.title, JSON.stringify(card.data, null, 2));
  }

  // ---- 呼吸灯 ----

  setBreathLight(state: BreathLightState): void {
    const config: Record<BreathLightState, { icon: string; label: string; color: string }> = {
      idle:       { icon: '○', label: 'Nodus',  color: DIM },
      listening:  { icon: '◐', label: 'listening', color: BLUE },
      thinking:   { icon: '◑', label: 'thinking...', color: YELLOW },
      speaking:   { icon: '●', label: 'speaking', color: GREEN },
      error:      { icon: '✖', label: 'error',   color: RED },
    };
    const { icon, label, color: col } = config[state] ?? config.idle;
    console.log(c(`${icon} ${label}`, col));
  }

  // ---- 输入条 ----

  showInput(placeholder = 'Type a query...'): void {
    console.log(c(`> ${placeholder}`, DIM));
  }

  hideInput(): void {
    // 终端环境无实际输入条，无需操作
  }

  setInputText(text: string): void {
    console.log(c(`> ${text}`, DIM));
  }

  // ---- 代码导航 ----

  navigateToSymbol(filePath: string, line: number, column = 1): void {
    console.log(c(`→ ${filePath}:${line}:${column}`, BLUE));
  }

  renderCodeSnippet(filePath: string, lineRange: { start: number; end: number }, language?: Language): string {
    // 读取片段：取中心行附近上下文
    const centerLine = Math.floor((lineRange.start + lineRange.end) / 2);
    const contextLines = Math.max(1, lineRange.end - lineRange.start + 1);
    const lines = readFileSnippet(filePath, centerLine, contextLines);
    if (lines.length === 0) return c(`\n[无法读取: ${filePath}]\n`, DIM);
    return renderSnippet(filePath, lines, language ?? 'typescript');
  }

  // ---- private helpers ----

  private renderSymbolList(symbols: Symbol[]): string {
    if (symbols.length === 0) return c('未找到匹配的符号', DIM);

    let out = c(`\n找到 ${symbols.length} 个符号:\n`, BOLD);
    for (const sym of symbols) {
      const kindIcon = this.kindIcon(sym.kind);
      const loc = `${sym.location.file_path}:${sym.location.line_start}`;
      const exportMark = sym.is_exported ? c('export ', DIM) : '';
      out += `\n  ${kindIcon} ${c(sym.name, BOLD)} ${c(`[${sym.kind}]`, DIM)}`;
      out += `\n    ${exportMark}${c(loc, BLUE)}`;
      if (sym.signature) {
        out += `\n    ${c(sym.signature, DIM)}`;
      }
    }
    return out + '\n';
  }

  private renderReferenceList(refs: Reference[], language?: Language): string {
    if (refs.length === 0) return c('未找到引用', DIM);

    // 按文件分组
    const byFile = new Map<string, Reference[]>();
    for (const ref of refs) {
      const fp = ref.location.file_path;
      if (!byFile.has(fp)) byFile.set(fp, []);
      byFile.get(fp)!.push(ref);
    }

    let out = c(`\n${refs.length} 处引用`, BOLD);
    const lang = language ?? 'typescript';
    for (const [file, fileRefs] of byFile) {
      out += `\n${c(`\n  ${file}`, BLUE)}`;
      for (const ref of fileRefs) {
        const linePrefix = `    L${ref.location.line_start}`.padEnd(8);
        out += `\n${c(linePrefix, DIM)} ${c(ref.kind, YELLOW)}`;

        // 代码片段（3 行上下文）
        const snippet = readFileSnippet(
          ref.location.file_path,
          ref.location.line_start,
          1,
        );
        if (snippet.length > 0) {
          out += renderSnippet(file, snippet, lang);
        }
      }
    }
    return out + '\n';
  }

  private renderCallGraph(graph: CallGraph): string {
    if (graph.nodes.length === 0) return c('调用图为空', DIM);

    const nodeMap = new Map<string, CallGraphNode>(
      graph.nodes.map(n => [n.symbol_id, n]),
    );

    const rootId = graph.root_symbol_id;
    const root = nodeMap.get(rootId);
    if (!root) return c('调用图根节点不存在', DIM);

    // 正向邻接表：from -> to（callees 使用）
    const forwardAdj = new Map<string, string[]>();
    // 反向邻接表：to -> from（callers 使用）
    const reverseAdj = new Map<string, string[]>();
    // 按树中父子关系索引的边类型，避免遍历 edges 数组
    const forwardEdgeKinds = new Map<string, ReferenceKind>();
    const reverseEdgeKinds = new Map<string, ReferenceKind>();
    for (const edge of graph.edges) {
      if (!forwardAdj.has(edge.from)) forwardAdj.set(edge.from, []);
      forwardAdj.get(edge.from)!.push(edge.to);
      if (!reverseAdj.has(edge.to)) reverseAdj.set(edge.to, []);
      reverseAdj.get(edge.to)!.push(edge.from);
      forwardEdgeKinds.set(`${edge.from}→${edge.to}`, edge.kind);
      reverseEdgeKinds.set(`${edge.to}→${edge.from}`, edge.kind);
    }

    let out = c('\n调用图', BOLD);
    if (graph.direction === 'callers') {
      out += c(' （上游调用方）', DIM);
    } else if (graph.direction === 'callees') {
      out += c(' （下游被调用方）', DIM);
    } else {
      out += c(' （双向）', DIM);
    }
    out += `\n${c('最大深度:', DIM)} ${c(String(graph.max_depth), YELLOW)}\n`;

    const formatNode = (id: string): string => {
      const n = nodeMap.get(id);
      if (!n) return c(`[unknown:${id}]`, DIM);
      const fileName = n.file_path.split('/').pop() ?? n.file_path;
      const risk = n.has_risk ? c(' ⚠', YELLOW) : '';
      return `${c(n.symbol_name, BOLD)} ${c(`[${fileName}:${n.line}]`, DIM)}${risk}`;
    };

    interface TreeCtx {
      adj: Map<string, string[]>;
      edgeKinds: Map<string, ReferenceKind>;
      visited: Set<string>;
    }

    interface TreeNodeOpts {
      id: string;
      prefix: string;
      isLast: boolean;
      depth: number;
      parentId?: string;
    }

    const printTree = ({ adj, edgeKinds, visited }: TreeCtx, { id, prefix, isLast, depth, parentId }: TreeNodeOpts): string => {
      const edgeKind = parentId ? edgeKinds.get(`${parentId}→${id}`) : undefined;

      if (visited.has(id)) {
        const edgeLabel = parentId ? ` ${c(`· ${edgeKind ?? 'unknown'}`, DIM)}` : '';
        return `${prefix}${isLast ? '└─ ' : '├─ '}${formatNode(id)}${edgeLabel} ${c('(cycle)', RED)}\n`;
      }
      visited.add(id);

      const edgeLabel = parentId
        ? ` ${c(`· ${edgeKind ?? 'unknown'}`, DIM)}`
        : '';
      const connector = isLast ? '└─ ' : '├─ ';
      const kids = adj.get(id) ?? [];

      // 超过最大深度且仍有子节点时截断，避免继续递归
      if (depth >= graph.max_depth && kids.length > 0) {
        return `${prefix}${connector}${formatNode(id)}${edgeLabel} ${c(`(... 已截断，最大深度 ${graph.max_depth})`, RED)}\n`;
      }

      let result = `${prefix}${connector}${formatNode(id)}${edgeLabel}\n`;
      for (let i = 0; i < kids.length; i++) {
        const childLast = i === kids.length - 1;
        const nextPrefix = prefix + (isLast ? '   ' : '│  ');
        result += printTree(
          { adj, edgeKinds, visited },
          { id: kids[i]!, prefix: nextPrefix, isLast: childLast, depth: depth + 1, parentId: id },
        );
      }
      return result;
    };

    if (graph.direction === 'callers') {
      out += printTree(
        { adj: reverseAdj, edgeKinds: reverseEdgeKinds, visited: new Set() },
        { id: rootId, prefix: '  ', isLast: true, depth: 0 },
      );
    } else if (graph.direction === 'callees') {
      out += printTree(
        { adj: forwardAdj, edgeKinds: forwardEdgeKinds, visited: new Set() },
        { id: rootId, prefix: '  ', isLast: true, depth: 0 },
      );
    } else {
      out += `\n${c('上游', BOLD)}\n`;
      out += printTree(
        { adj: reverseAdj, edgeKinds: reverseEdgeKinds, visited: new Set() },
        { id: rootId, prefix: '  ', isLast: true, depth: 0 },
      );
      out += `\n${c('下游', BOLD)}\n`;
      out += printTree(
        { adj: forwardAdj, edgeKinds: forwardEdgeKinds, visited: new Set() },
        { id: rootId, prefix: '  ', isLast: true, depth: 0 },
      );
    }

    return out;
  }

  private renderImpact(result: ImpactReport): string {
    const riskColor = result.riskLevel === 'high' ? RED : result.riskLevel === 'medium' ? YELLOW : GREEN;
    let out = c(`\n影响分析: ${result.symbol.name}`, BOLD) + '\n';
    out += `  风险级别: ${c(result.riskLevel.toUpperCase(), riskColor)}\n`;
    out += `  直接影响: ${result.directCallers.length} 个调用方\n`;
    out += `  涉及文件: ${result.affectedFiles.length} 个\n`;
    if (result.affectedFiles.length <= 10) {
      for (const f of result.affectedFiles) {
        out += `    ${c(f, BLUE)}\n`;
      }
    }
    return out;
  }

  private renderChangeHistory(records: ChangeRecord[]): string {
    if (records.length === 0) return c('暂无变更记录', DIM);

    let out = c(`\n${records.length} 次提交:`, BOLD) + '\n';
    for (const rec of records) {
      const shortHash = rec.commitHash.slice(0, 7);
      const time = rec.timestamp.slice(0, 10);
      out += `\n  ${c(shortHash, YELLOW)} ${c(rec.commitMessage, BOLD)}`;
      out += `\n  ${c(`${rec.author} · ${time} · ${rec.diffSummary}`, DIM)}`;

      // 受影响的符号及其代码片段（最多 5 个）
      const topSymbols = rec.changedSymbols.slice(0, 5);
      for (const sym of topSymbols) {
        out += `\n    ${c(sym.name, BOLD)} ${c(`[${sym.kind}]`, DIM)} ${c(`${sym.location.file_path}:${sym.location.line_start}`, BLUE)}`;
        const snippet = readFileSnippet(
          sym.location.file_path,
          sym.location.line_start,
          1,
        );
        if (snippet.length > 0) {
          out += renderSnippet(sym.location.file_path, snippet, sym.language);
        }
      }
    }
    return out + '\n';
  }

  private renderSymbolOverview(symbols: Symbol[]): string {
    return this.renderSymbolList(symbols);
  }

  private renderSymbolRanking(title: string, metrics: SymbolMetric[]): string {
    if (metrics.length === 0) return c(`\n${title}: 无数据`, DIM);

    let out = c(`\n${title}\n`, BOLD);
    const rankWidth = String(metrics.length).length;
    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i]!;
      const rank = String(i + 1).padStart(rankWidth, ' ');
      const loc = `${m.symbol.location.file_path}:${m.symbol.location.line_start}`;
      out += `\n  ${c(rank, YELLOW)}  ${c(m.symbol.name, BOLD)} ${c(`[${m.symbol.kind}]`, DIM)}`;
      out += `\n      ${c(String(m.metric), GREEN)} ${c(m.detail ?? 'refs', DIM)} · ${c(loc, BLUE)}`;
    }
    return out + '\n';
  }

  private renderModuleCoupling(couplings: ModuleCoupling[]): string {
    if (couplings.length === 0) return c('\n模块耦合: 无数据', DIM);

    let out = c('\n模块耦合度 Top\n', BOLD);
    const colWidth = Math.max(...couplings.map(c => c.moduleA.length), ...couplings.map(c => c.moduleB.length));
    out += `\n  ${c('#', DIM)}  ${c('Module A'.padEnd(colWidth), BOLD)}  ${c('Module B'.padEnd(colWidth), BOLD)}  ${c('Refs', BOLD)}`;
    for (let i = 0; i < couplings.length; i++) {
      const cpl = couplings[i]!;
      out += `\n  ${String(i + 1).padStart(2, ' ')}  ${c(cpl.moduleA.padEnd(colWidth), BLUE)}  ${c(cpl.moduleB.padEnd(colWidth), BLUE)}  ${c(String(cpl.referenceCount), YELLOW)}`;
    }
    return out + '\n';
  }

  private renderCallChains(chains: CallChain[]): string {
    if (chains.length === 0) return c('\n调用链: 无数据', DIM);

    let out = c('\n最长调用链\n', BOLD);
    for (const chain of chains) {
      const names = chain.chain.map(s => c(s.name, BOLD)).join(' → ');
      out += `\n  ${names} ${c(`(depth: ${chain.depth})`, DIM)}`;
    }
    return out + '\n';
  }

  private renderTodoList(comments: TodoComment[]): string {
    if (comments.length === 0) return c('\n未扫描到 TODO / FIXME / HACK', DIM);

    let out = c(`\n${comments.length} 处待办 / 备忘\n`, BOLD);
    for (const comment of comments) {
      const kindColor = comment.kind === 'TODO' ? YELLOW : comment.kind === 'FIXME' ? RED : BLUE;
      out += `\n  ${c(comment.kind, kindColor)} ${c(`${comment.filePath}:${comment.line}`, BLUE)}`;
      out += `\n    ${comment.text}`;
    }
    return out + '\n';
  }

  private renderStatsReport(stats: import('../code-intel/code-intelligence.js').StatsReport): string {
    let out = c('\n代码库统计\n', BOLD);
    out += `\n  ${c('符号总数:', DIM)}      ${c(String(stats.totalSymbols), GREEN)}`;
    out += `\n  ${c('引用总数:', DIM)}      ${c(String(stats.totalReferences), GREEN)}`;
    out += `\n  ${c('导出符号数:', DIM)}    ${c(String(stats.exportedSymbols), GREEN)}`;
    out += `\n  ${c('已索引文件数:', DIM)}  ${c(String(stats.filesIndexed), GREEN)}`;
    return out + '\n';
  }

  private renderChangeHeat(files: { filePath: string; changeCount: number }[]): string {
    if (files.length === 0) return c('\n暂无变更热点数据', DIM);

    let out = c('\n变更热点文件\n', BOLD);
    const maxCount = Math.max(...files.map(f => f.changeCount), 1);
    for (const f of files) {
      const barLength = Math.round((f.changeCount / maxCount) * 10);
      const bar = '█'.repeat(barLength).padEnd(10, '░');
      out += `\n  ${c(f.filePath, BLUE)}  ${c(String(f.changeCount).padStart(3, ' '), YELLOW)} ${c(bar, RED)}`;
    }
    return out + '\n';
  }

  private renderTypeRelationships(root: Symbol, relationships: TypeRelationship[]): string {
    if (relationships.length === 0) return c(`\n${root.name} 没有匹配的类型关系`, DIM);

    let out = c(`\n${root.name} 的类型关系:\n`, BOLD);
    for (const rel of relationships) {
      const kindLabel = rel.kind === 'subclass' ? '子类'
        : rel.kind === 'implementation' ? '实现'
        : '类型使用';
      const loc = `${rel.symbol.location.file_path}:${rel.symbol.location.line_start}`;
      out += `\n  ${c(kindLabel, YELLOW)} ${c(rel.symbol.name, BOLD)} ${c(`[${rel.symbol.kind}]`, DIM)}`;
      out += `\n    ${c(loc, BLUE)}`;
    }
    return out + '\n';
  }

  private renderNodusErrorCard(error: NodusError, module: string): string {
    const suggestion = getDegradationSuggestion(error.code);
    let out = c('\n⚠ 运行降级提示', YELLOW) + '\n';
    out += `  来源模块: ${c(module, DIM)}\n`;
    out += `  错误码:   ${c(error.code, RED)}\n`;
    out += `  说明:     ${error.message}\n`;
    out += `  建议:     ${c(suggestion, GREEN)}\n`;
    return out;
  }

  private renderAmbiguous(candidates: QueryIntent[]): string {
    let out = c('\n你指的是？', BOLD) + '\n';
    for (let i = 0; i < candidates.length; i++) {
      const cnd = candidates[i]!;
      const letter = String.fromCharCode(65 + i); // A, B, C
      out += `\n  ${c(letter, BOLD)}  ${cnd.intentType}`;
      if (cnd.entities && Object.keys(cnd.entities).length > 0) {
        out += ` ${c(JSON.stringify(cnd.entities), DIM)}`;
      }
    }
    return out + '\n';
  }

  private inferCardKind(data: Card['data']): Card['kind'] {
    if ('kind' in data && typeof data.kind === 'string') {
      const k = data.kind;
      if (k === 'error') {
        return 'error';
      }
      if (['symbol_list', 'reference_list', 'call_graph', 'impact_report', 'change_history', 'symbol_overview',
           'symbol_ranking', 'module_coupling', 'call_chain', 'todo_list', 'stats_report', 'change_heat',
           'type_relationship_list'].includes(k)) {
        return k as Card['kind'];
      }
      if (['empty_input', 'unparseable', 'ambiguous', 'unsupported'].includes(k)) {
        return 'ambiguity';
      }
    }
    if (Array.isArray(data) && data.length > 0) {
      if ('intentType' in data[0]) return 'ambiguity';
      if ('text' in data[0] && 'reason' in data[0]) return 'recommendation_list';
      if ('text' in data[0] && 'timestamp' in data[0]) return 'history_list';
    }
    if ('root_path' in data) return 'env_status';
    if ('title' in data && 'body' in data) return 'notification';
    return 'notification';
  }

  private kindIcon(kind: string): string {
    switch (kind) {
      case 'function':
      case 'method': return c('ƒ', GREEN);
      case 'class': return c('C', BLUE);
      case 'interface': return c('I', YELLOW);
      case 'type': return c('T', YELLOW);
      case 'variable': return c('v', DIM);
      default: return '·';
    }
  }
}
