// ============================================================
// TerminalRenderer — 终端格式化输出
// ============================================================

import type { UIRenderer, Card, BreathLightState } from './ui-renderer.js';
import type { QueryResult } from '../code-intel/code-intelligence.js';
import type { IntentError, QueryIntent } from '../intent/intent-engine.js';
import type { Symbol, Reference, CallGraph, ProjectMeta } from '../common/types.js';
import type { ImpactReport, ChangeRecord, TypeRelationship } from '../code-intel/code-intelligence.js';
import type { SymbolMetric, ModuleCoupling, CallChain, TodoComment } from '../code-intel/code-analytics.js';

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

  // ---- 卡片系统 ----

  private cards = new Map<string, Card>();

  createCard(
    id: string,
    title: string,
    data: QueryResult | IntentError | ProjectMeta | QueryIntent[] | { title: string; body: string },
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
    // 终端渲染器：以状态标签形式输出
    const labels: Record<BreathLightState, string> = {
      idle: '[idle]',
      listening: '[listening]',
      thinking: '[thinking]',
      speaking: '[speaking]',
      error: '[error]',
    };
    console.log(c(labels[state] ?? '[unknown]', DIM));
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

  renderCodeSnippet(filePath: string, lineRange: { start: number; end: number }): string {
    return c(`\n[Code: ${filePath}:${lineRange.start}-${lineRange.end}]\n`, DIM);
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

  private renderReferenceList(refs: Reference[]): string {
    if (refs.length === 0) return c('未找到引用', DIM);

    // 按文件分组
    const byFile = new Map<string, Reference[]>();
    for (const ref of refs) {
      const fp = ref.location.file_path;
      if (!byFile.has(fp)) byFile.set(fp, []);
      byFile.get(fp)!.push(ref);
    }

    let out = c(`\n${refs.length} 处引用`, BOLD);
    for (const [file, fileRefs] of byFile) {
      out += `\n${c(`\n  ${file}`, BLUE)}`;
      for (const ref of fileRefs) {
        const linePrefix = `    L${ref.location.line_start}`.padEnd(8);
        out += `\n${c(linePrefix, DIM)} ${c(ref.kind, YELLOW)}`;
      }
    }
    return out + '\n';
  }

  private renderCallGraph(graph: CallGraph): string {
    if (graph.nodes.length === 0) return c('调用图为空', DIM);

    let out = c('\n调用图:', BOLD) + '\n';

    // 构建邻接表
    const children = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const from = graph.nodes.find(n => n.symbol_id === edge.from);
      const to = graph.nodes.find(n => n.symbol_id === edge.to);
      if (from && to) {
        if (!children.has(from.symbol_name)) children.set(from.symbol_name, []);
        children.get(from.symbol_name)!.push(to.symbol_name);
      }
    }

    // 找根节点
    const allTargets = new Set([...children.values()].flatMap(v => [...v]));
    const roots = graph.nodes.filter(n => !allTargets.has(n.symbol_name));

    function printNode(name: string, depth: number, prefix: string): string {
      let result = '';
      const nodeNames = graph.nodes.filter(n => n.symbol_name === name);
      const node = nodeNames[0];
      if (node) {
        const risk = node.has_risk ? c(' ⚠', YELLOW) : '';
        result += `${prefix}${c(name, BOLD)} ${c(`[${node.file_path.split('/').pop()}:${node.line}]`, DIM)}${risk}\n`;
      } else {
        result += `${prefix}${name}\n`;
      }

      const kids = children.get(name) ?? [];
      for (let i = 0; i < kids.length; i++) {
        const isLast = i === kids.length - 1;
        const connector = isLast ? '└─ ' : '├─ ';
        const nextPrefix = prefix + (isLast ? '   ' : '│  ');
        result += printNode(kids[i]!, depth + 1, prefix + connector);
      }
      return result;
    }

    for (const root of roots) {
      out += printNode(root.symbol_name, 0, '  ');
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
      if (['symbol_list', 'reference_list', 'call_graph', 'impact_report', 'change_history', 'symbol_overview',
           'symbol_ranking', 'module_coupling', 'call_chain', 'todo_list', 'stats_report', 'change_heat',
           'type_relationship_list'].includes(k)) {
        return k as Card['kind'];
      }
      if (['empty_input', 'unparseable', 'ambiguous', 'unsupported'].includes(k)) {
        return 'ambiguity';
      }
    }
    if (Array.isArray(data) && data.length > 0 && 'intentType' in data[0]) return 'ambiguity';
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
