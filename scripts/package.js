#!/usr/bin/env node
// ============================================================
// Nodus (结绳) — 一键打包脚本
// 将编译后的 dist/ 与生产依赖打包到 bundle/ 目录，生成可独立分发的 CLI。
// ============================================================

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const bundleDir = resolve(rootDir, 'bundle');
const distDir = resolve(rootDir, 'dist');

if (!existsSync(distDir)) {
  console.error('错误：未找到 dist/ 目录。请先运行 npm run build');
  process.exit(1);
}

// 1. 清理并创建 bundle 目录
console.log('Cleaning bundle/...');
if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true, force: true });
}
mkdirSync(bundleDir, { recursive: true });

// 2. 复制编译产物
console.log('Copying dist/ to bundle/dist/...');
cpSync(distDir, resolve(bundleDir, 'dist'), { recursive: true, dereference: true });

// 3. 复制 package.json 并移除开发依赖与脚本，只保留生产信息
console.log('Preparing bundle/package.json...');
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));
delete pkg.devDependencies;
delete pkg.scripts;
pkg.main = 'dist/main.js';
pkg.bin = { nodus: 'dist/main.js' };
writeFileSync(
  resolve(bundleDir, 'package.json'),
  JSON.stringify(pkg, null, 2) + '\n'
);

// 4. 安装生产依赖
console.log('Installing production dependencies in bundle/...');
execSync('npm install --omit=dev --no-audit --no-fund', {
  cwd: bundleDir,
  stdio: 'inherit',
  shell: true,
});

// 5. 创建可执行入口（Unix / Windows）
const unixWrapper = resolve(bundleDir, 'nodus');
writeFileSync(
  unixWrapper,
  `#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
execFileSync('node', [resolve(__dirname, 'dist/main.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
`,
  { mode: 0o755 }
);

const winWrapper = resolve(bundleDir, 'nodus.cmd');
writeFileSync(
  winWrapper,
  '@echo off\nnode "%~dp0dist\\main.js" %*\n'
);

console.log('\n✅ 打包完成：bundle/');
console.log('   运行方式：');
console.log('   • npm run run:pkg');
console.log('   • ./bundle/nodus');
console.log('   • node bundle/dist/main.js');
