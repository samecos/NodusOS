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

  process.stdin.setEncoding('utf-8');
  for await (const line of readLines(process.stdin)) {
    const input = line.trim();
    if (!input) continue;
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
