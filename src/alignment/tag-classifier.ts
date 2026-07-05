// ============================================================
// 修正 tag 分类器 — 基于 diff 的启发式规则匹配
// ============================================================

/**
 * 分析 before / after 文本差异，返回修正 tag 列表
 */
export function classifyDiff(before: string, after: string): string[] {
  const tags: string[] = [];
  const addedLines = extractAddedLines(before, after);
  const removedLines = extractRemovedLines(before, after);

  // add_null_check: 新增了 null/undefined 判断（含 if (!x) 与 if (!fn()) 形式的真值守护）
  if (addedLines.some(l => /if\s*\(\s*!?\w+\s*(===?|!==?)\s*(null|undefined)\)/.test(l) || /if\s*\(\s*!\w+\s*(?:\([^)]*\))?\s*\)/.test(l))) {
    if (removedLines.every(l => !/if\s*\(\s*!?\w+\s*(===?|!==?)\s*(null|undefined)\)/.test(l))) {
      tags.push('add_null_check');
    }
  }

  // add_error_handling: 新增了 try/catch 或 except
  if (addedLines.some(l => /try\s*\{|catch\s*\(|except\s*:/.test(l))) {
    if (removedLines.every(l => !/try\s*\{|catch\s*\(/.test(l))) {
      tags.push('add_error_handling');
    }
  }

  // add_type: 新增了类型标注（: Type 或 <Type>）
  if (addedLines.some(l => /:\s*(number|string|boolean|any|void|never|unknown)\b/.test(l))
      && removedLines.some(l => !/:\s*(number|string|boolean|any|void|never|unknown)\b/.test(l))) {
    tags.push('add_type');
  }

  // remove_debug: 删除了 console.log / debugger
  if (removedLines.some(l => /console\.(log|debug|info|warn|error)\s*\(/.test(l) || /\bdebugger\b/.test(l))) {
    tags.push('remove_debug');
  }

  // rename_symbol: 函数/变量名变化
  const beforeNameMatch = before.match(/(?:function|const|let|var)\s+(\w+)/);
  const afterNameMatch = after.match(/(?:function|const|let|var)\s+(\w+)/);
  if (beforeNameMatch && afterNameMatch && beforeNameMatch[1] !== afterNameMatch[1]) {
    tags.push('rename_symbol');
  }

  // extract_function: 新增了函数声明且 after 行数明显增多
  if (addedLines.filter(l => /function\s+\w+|=>\s*{/.test(l)).length > 0 && after.split('\n').length > before.split('\n').length + 3) {
    tags.push('extract_function');
  }

  // revert: after 行数显著少于 before
  if (after.split('\n').length < before.split('\n').length * 0.6) {
    tags.push('revert');
  }

  // simplify: 删除了冗余分支（删除行数 > 新增行数且无上述模式）
  if (removedLines.length > addedLines.length * 2 && tags.length === 0) {
    tags.push('simplify');
  }

  return tags;
}

/** 提取 after 中新增的行（不在 before 中） */
function extractAddedLines(before: string, after: string): string[] {
  const beforeSet = new Set(before.split('\n').map(l => l.trim()));
  return after.split('\n').filter(l => !beforeSet.has(l.trim())).filter(l => l.trim().length > 0);
}

/** 提取 before 中删除的行（不在 after 中） */
function extractRemovedLines(before: string, after: string): string[] {
  const afterSet = new Set(after.split('\n').map(l => l.trim()));
  return before.split('\n').filter(l => !afterSet.has(l.trim())).filter(l => l.trim().length > 0);
}
