#!/usr/bin/env node
// scripts/check-native-deps.js
// 检测关键原生依赖是否能正常加载

import { platform } from 'node:os';

const PACKAGES = [
  'better-sqlite3',
  'tree-sitter',
  'tree-sitter-typescript',
  'tree-sitter-javascript',
  'tree-sitter-python',
];

let allOk = true;

console.log(`[check-native-deps] Platform: ${platform()}`);
console.log(`[check-native-deps] Node: ${process.version}`);
console.log();

for (const name of PACKAGES) {
  try {
    const mod = await import(name);
    const info = typeof mod === 'object' && mod !== null
      ? (mod.default ? 'default export present' : 'module loaded')
      : 'loaded';
    console.log(`✅ ${name}: ${info}`);
  } catch (err) {
    allOk = false;
    console.error(`❌ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log();
if (allOk) {
  console.log('[check-native-deps] All native dependencies loaded successfully.');
  process.exit(0);
} else {
  console.error('[check-native-deps] Some native dependencies failed to load.');
  console.error('[check-native-deps] Try running: npm run rebuild:native');
  process.exit(1);
}
