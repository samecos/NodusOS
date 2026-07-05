import type { BriefCard } from '../common/types.js';
import type { DebtQueryResult } from '../understanding-debt/debt-engine.js';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/**
 * 渲染带标注的代码视图 — P1 终端近似版
 *
 * 接收文件路径、源码内容、理解债条目与简报卡，按符号名匹配到代码行，
 * 在对应行下方挂载债值标注与简报摘要，并在尾部附简报卡列表。
 */
export function renderAnnotatedView(
  filePath: string,
  code: string,
  debts: DebtQueryResult[],
  briefs: BriefCard[],
): string {
  const lines = code.split('\n');
  const debtByLine = new Map<number, DebtQueryResult>();
  for (const d of debts) {
    // 简化：按符号名匹配行
    const lineIdx = lines.findIndex(l => l.includes(d.name));
    if (lineIdx >= 0) debtByLine.set(lineIdx + 1, d);
  }

  const levelLabel: Record<string, string> = { green: '绿', yellow: '黄', red: '红' };
  const levelColor: Record<string, string> = { green: GREEN, yellow: YELLOW, red: RED };

  let out = `${BOLD}${filePath}${RESET}\n`;
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const debt = debtByLine.get(lineNum);
    const prefix = `${DIM}${String(lineNum).padStart(4)}${RESET}  `;
    out += `${prefix}${lines[i]}\n`;
    if (debt) {
      const color = levelColor[debt.level] ?? RESET;
      out += `     ${color}└─[AI 改过] 债值 ${debt.debt.toFixed(1)} ●${levelLabel[debt.level]}${RESET}`;
      const brief = briefs.find(b => b.symbols.some(s => s.name === debt.name));
      if (brief) {
        out += ` ${DIM}│ ${brief.title} │ 影响半径 ${brief.impact_radius} │ 风险 ${brief.risk_level}${RESET}`;
      }
      if (!debt.examined && !debt.confirmed) {
        out += ` ${YELLOW}│ 建议从此处开始审查${RESET}`;
      }
      out += '\n';
    }
  }

  // 尾部附简报卡列表
  if (briefs.length > 0) {
    out += `\n${BOLD}── 简报卡 ──${RESET}\n`;
    for (const b of briefs) {
      out += `${CYAN}[${b.chunk_id}]${RESET} ${b.title} · 影响 ${b.impact_radius} · 风险 ${b.risk_level}`;
      if (b.suggested_inspect_point) {
        out += ` ${DIM}→ 建议抽检 ${b.suggested_inspect_point.file}:${b.suggested_inspect_point.line}${RESET}`;
      }
      out += '\n';
    }
  }

  return out;
}
