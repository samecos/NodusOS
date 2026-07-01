#!/usr/bin/env node
// ============================================================
// Nodus (结绳) — AI-Native OS for Developers
// 入口点
// ============================================================

import { mkdirSync } from 'node:fs';
import { NodusShell } from './shell/nodus-shell.js';

const NODUS_DIR = `${process.env.HOME ?? process.env.USERPROFILE ?? '.'}/.nodus`;
const DB_PATH = `${NODUS_DIR}/nodus.db`;
const PROJECTS = process.argv.slice(2);

// 确保 ~/.nodus/ 目录存在
mkdirSync(NODUS_DIR, { recursive: true });

async function main() {
  const shell = new NodusShell({
    projectPaths: PROJECTS.length > 0 ? PROJECTS : [process.cwd()],
    dbPath: DB_PATH,
    locale: process.env.LANG?.startsWith('zh') ? 'zh-CN' : 'en-US',
  });

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
