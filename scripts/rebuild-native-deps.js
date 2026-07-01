#!/usr/bin/env node
// scripts/rebuild-native-deps.js
// 一键重新编译关键原生依赖

import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const PACKAGES = [
  'better-sqlite3',
  'tree-sitter',
  'tree-sitter-typescript',
  'tree-sitter-javascript',
  'tree-sitter-python',
];

if (platform() === 'win32') {
  console.log('[rebuild-native-deps] Windows detected.');
  console.log('[rebuild-native-deps] Please run the following commands manually in PowerShell:');
  for (const name of PACKAGES) {
    console.log(`  npm rebuild ${name}`);
  }
  process.exit(0);
}

// 先修复 node-gyp-build 可能无执行权限的问题（macOS 常见）
try {
  execSync('chmod +x node_modules/.bin/node-gyp-build', { stdio: 'inherit' });
} catch {
  // 忽略错误：可能路径不同或已可执行
}

let allOk = true;

for (const name of PACKAGES) {
  console.log(`[rebuild-native-deps] Rebuilding ${name}...`);
  try {
    execSync(`npm rebuild ${name}`, { stdio: 'inherit' });
    console.log(`[rebuild-native-deps] ✅ ${name} rebuilt`);
  } catch (err) {
    allOk = false;
    console.error(`[rebuild-native-deps] ❌ ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log();
if (allOk) {
  console.log('[rebuild-native-deps] All packages rebuilt. Run `npm run check:native` to verify.');
  process.exit(0);
} else {
  console.error('[rebuild-native-deps] Some packages failed. See output above.');
  process.exit(1);
}
