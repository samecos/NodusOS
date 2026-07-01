# Task 2: 创建统一 Rebuild 脚本

**Files:**
- Create: `scripts/rebuild-native-deps.js`
- Test: 运行 `node scripts/rebuild-native-deps.js`

**Interfaces:**
- Consumes: npm CLI, node-gyp
- Produces: 重新编译后的 `.node` 二进制；控制台输出每个包的 rebuild 结果；退出码 0（全部成功）或 1（有失败）

## Steps

### Step 1: 编写 rebuild 脚本

```javascript
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
```

### Step 2: 赋予可执行权限并运行 rebuild

Run:
```bash
chmod +x scripts/rebuild-native-deps.js
node scripts/rebuild-native-deps.js
```

Expected: 五个包都显示 `✅ <name> rebuilt`，最后提示运行 `npm run check:native`。

### Step 3: Commit

```bash
git add scripts/rebuild-native-deps.js
git commit -m "feat(scripts): add unified native dependency rebuild script"
```

## Global Constraints

- ESM 模块系统，`package.json` 中 `"type": "module"`
- 不引入新的运行时依赖
- 脚本必须跨平台可跑；Windows 上降级为提示手动执行
- 修改后 `npm test` 仍须 160 个测试全绿
- 已存在的 `scripts/check-native-deps.js` 不要修改
