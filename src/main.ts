#!/usr/bin/env node
// ============================================================
// Nodus (结绳) — AI-Native OS for Developers
// 入口点
// ============================================================

import { NodusShell } from './shell/nodus-shell.js';
import { JsonConfigManager } from './common/config.js';

const PROJECTS = process.argv.slice(2);

async function main() {
  const configManager = new JsonConfigManager();
  const initialConfig = configManager.get();

  // 命令行传入的项目路径覆盖配置文件
  if (PROJECTS.length > 0) {
    initialConfig.projectPaths = PROJECTS;
    configManager.set('projectPaths', PROJECTS);
  }

  const shell = new NodusShell(configManager);

  await shell.bootstrap();

  // REPL: stdin loop (works for both TTY and pipe)
  if (!process.stdin.isTTY) {
    console.log('\nNodus is ready.\n');
  } else {
    console.log('\nNodus is ready. Type a query or /quit to exit.\n');
  }

  // 记录最近一次推荐，用于序号执行
  let lastRecommendations: Array<{ text: string; reason: string }> = [];

  process.stdin.setEncoding('utf-8');
  for await (const line of readLines(process.stdin)) {
    const input = line.trim();
    if (!input) {
      // 空行 → 显示推荐
      lastRecommendations = shell.getRecommendationList();
      const output = shell.getRecommendations();
      console.log(output);
      continue;
    }

    // 数字序号 → 执行对应推荐
    if (/^\d+$/.test(input) && lastRecommendations.length > 0) {
      const idx = parseInt(input, 10) - 1;
      if (idx >= 0 && idx < lastRecommendations.length) {
        const recText = lastRecommendations[idx]!.text;
        console.log(`> ${recText}`);
        const output = await shell.handleQueryFormatted(recText);
        console.log(output);
        continue;
      }
    }

    // 推荐已被消费，清空
    lastRecommendations = [];

    // /history 命令
    if (input === '/history' || input.startsWith('/history ')) {
      const parts = input.split(/\s+/);
      const limit = parts[1] ? Math.min(parseInt(parts[1], 10) || 10, 50) : 10;
      const output = shell.getHistory(limit);
      console.log(output);
      continue;
    }

    // /learn 命令 — 重新加载反馈数据
    if (input === '/learn') {
      const count = shell.learnFeedback();
      const total = shell.getLearnedCount();
      if (count > 0) {
        console.log(`已从反馈数据中学习 ${count} 条新句式（共 ${total} 条）。`);
      } else {
        console.log(`没有新的反馈数据可学习（当前已有 ${total} 条学习句式）。`);
      }
      continue;
    }

    if (input === '/quit' || input === '/exit') break;

    try {
      const output = await shell.handleQueryFormatted(input);
      console.log(output);
    } catch (err) {
      console.error('Error:', err);
    }
  }

  await shell.shutdown();
}

async function* readLines(stream: NodeJS.ReadStream): AsyncGenerator<string> {
  let remainder = '';
  for await (const chunk of stream) {
    const text = remainder + (chunk as string);
    const lines = text.split('\n');
    remainder = lines.pop() ?? '';
    for (const line of lines) yield line;
  }
  if (remainder) yield remainder;
}

main().catch(console.error);
