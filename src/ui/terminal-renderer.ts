// ============================================================
// TerminalRenderer — 终端格式化输出
// ============================================================

import type { UIRenderer } from './ui-renderer.js';
import type { QueryResult } from '../code-intel/code-intelligence.js';
import type { IntentError, QueryIntent } from '../intent/intent-engine.js';
import type { Symbol, Reference, CallGraph } from '../common/types.js';
import type { ImpactReport, ChangeRecord } from '../code-intel/code-intelligence.js';

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

  // ---- private renderers ----

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
