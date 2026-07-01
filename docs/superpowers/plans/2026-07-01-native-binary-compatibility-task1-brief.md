# Task 1: 创建原生依赖诊断脚本

**Files:**
- Create: `scripts/check-native-deps.js`
- Test: 运行 `node scripts/check-native-deps.js`

**Interfaces:**
- Produces: 控制台输出诊断结果；进程退出码 0（全部正常）或 1（有失败）

## Steps

### Step 1: 编写诊断脚本

```javascript
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
```

### Step 2: 赋予可执行权限（Unix）并运行诊断

Run:
```bash
chmod +x scripts/check-native-deps.js
node scripts/check-native-deps.js
```

Expected:
```
[check-native-deps] Platform: darwin
[check-native-deps] Node: v20.x.x

✅ better-sqlite3: module loaded
✅ tree-sitter: module loaded
✅ tree-sitter-typescript: module loaded
✅ tree-sitter-javascript: module loaded
✅ tree-sitter-python: module loaded

[check-native-deps] All native dependencies loaded successfully.
```

### Step 3: Commit

```bash
git add scripts/check-native-deps.js
git commit -m "feat(scripts): add native dependency diagnostic script"
```

## Global Constraints

- ESM 模块系统，`package.json` 中 `"type": "module"`
- 不引入新的运行时依赖
- 脚本必须跨平台可跑
- 修改后 `npm test` 仍须 160 个测试全绿
