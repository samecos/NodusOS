# R1.1 原生二进制兼容性治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `better-sqlite3` 与 `tree-sitter` 系列包在目标平台（尤其是 macOS）能够可靠加载，并提供一键诊断与修复脚本。

**Architecture:** 通过 Node.js 脚本主动探测关键原生模块的加载状态；加载失败时给出一键 `npm run rebuild:native` 修复命令；将探测逻辑固化为测试用例，确保 CI 与本地环境第一时间暴露问题。

**Tech Stack:** Node.js 20+, npm, node-gyp, better-sqlite3, tree-sitter, tree-sitter-typescript, tree-sitter-javascript, tree-sitter-python, Vitest

## Global Constraints

- ESM 模块系统，`package.json` 中 `"type": "module"`
- TypeScript 严格模式，`verbatimModuleSyntax: true`
- 类型导入必须写 `import type { ... }`
- 测试覆盖新增脚本与关键加载路径
- 不引入新的运行时依赖；仅使用项目已有的包
- 脚本必须跨平台（macOS / Linux / Windows）可跑；Windows 上降级为提示手动执行
- 修改后 `npm test` 仍须全绿（当前基线为 165 个测试）

---

## File Structure

| 文件 | 责任 |
|------|------|
| `scripts/check-native-deps.js` | 诊断脚本：尝试 require 关键原生包，输出状态与修复建议 |
| `scripts/rebuild-native-deps.js` | 修复脚本：一键重新编译所有关键原生包 |
| `src/common/native-deps.test.ts` | 测试：验证关键原生包可在当前平台加载 |
| `package.json` | 新增 `check:native`、`rebuild:native` scripts |
| `readme.md` | 更新"原生依赖兼容性"章节，引用新脚本 |

---

### Task 1: 创建原生依赖诊断脚本

**Files:**
- Create: `scripts/check-native-deps.js`
- Test: 运行 `node scripts/check-native-deps.js`

**Interfaces:**
- Produces: 控制台输出诊断结果；进程退出码 0（全部正常）或 1（有失败）

- [ ] **Step 1: 编写诊断脚本**

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

- [ ] **Step 2: 赋予可执行权限（Unix）并运行诊断**

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

- [ ] **Step 3: Commit**

```bash
git add scripts/check-native-deps.js
git commit -m "feat(scripts): add native dependency diagnostic script"
```

---

### Task 2: 创建统一 Rebuild 脚本

**Files:**
- Create: `scripts/rebuild-native-deps.js`
- Test: 运行 `npm run rebuild:native`

**Interfaces:**
- Consumes: npm CLI, node-gyp
- Produces: 重新编译后的 `.node` 二进制；控制台输出每个包的 rebuild 结果

- [ ] **Step 1: 编写 rebuild 脚本**

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

- [ ] **Step 2: 赋予可执行权限并运行 rebuild**

Run:
```bash
chmod +x scripts/rebuild-native-deps.js
node scripts/rebuild-native-deps.js
```

Expected: 五個包都显示 `✅ <name> rebuilt`，最后提示运行 `npm run check:native`。

- [ ] **Step 3: Commit**

```bash
git add scripts/rebuild-native-deps.js
git commit -m "feat(scripts): add unified native dependency rebuild script"
```

---

### Task 3: 在 package.json 中注册命令

**Files:**
- Modify: `package.json`（`scripts` 字段）
- Test: 运行 `npm run check:native` 和 `npm run rebuild:native`

- [ ] **Step 1: 添加 scripts**

```json
"scripts": {
  "check:native": "node scripts/check-native-deps.js",
  "rebuild:native": "node scripts/rebuild-native-deps.js",
  ...
}
```

- [ ] **Step 2: 验证命令**

Run:
```bash
npm run check:native
npm run rebuild:native
```

Expected:
- `check:native` 输出全部 ✅，退出码 0
- `rebuild:native` 成功重新编译（或提示已是最新），退出码 0

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(package): add check:native and rebuild:native scripts"
```

---

### Task 4: 新增原生依赖加载测试

**Files:**
- Create: `src/common/native-deps.test.ts`
- Test: `npm test -- src/common/native-deps.test.ts`

**Interfaces:**
- Produces: Vitest 测试用例，加载失败时给出明确修复提示

- [ ] **Step 1: 编写测试**

```typescript
// src/common/native-deps.test.ts
import { describe, it, expect } from 'vitest';

const NATIVE_PACKAGES = [
  'better-sqlite3',
  'tree-sitter',
  'tree-sitter-typescript',
  'tree-sitter-javascript',
  'tree-sitter-python',
];

describe('Native dependency loading', () => {
  for (const name of NATIVE_PACKAGES) {
    it(`TC-UT-ND-001: should load ${name}`, async () => {
      let mod: unknown;
      try {
        mod = await import(name);
      } catch (err) {
        throw new Error(
          `Failed to load native dependency "${name}". ` +
          `Run "npm run rebuild:native" and try again. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      expect(mod).toBeDefined();
    });
  }
});
```

- [ ] **Step 2: 运行新测试**

Run:
```bash
npm test -- src/common/native-deps.test.ts
```

Expected:
```
 ✓ src/common/native-deps.test.ts (5 tests)
```

- [ ] **Step 3: 运行完整测试套件**

Run:
```bash
npm test
```

Expected: `Test Files 17 passed (17) / Tests 165 passed (165)`（新增 5 个测试）

- [ ] **Step 4: Commit**

```bash
git add src/common/native-deps.test.ts
git commit -m "test(common): add native dependency loading tests"
```

---

### Task 5: 更新 README 指引

**Files:**
- Modify: `readme.md`（"原生依赖兼容性"章节与 Quick Start）

- [ ] **Step 1: 更新 Quick Start 测试说明**

在 `readme.md` 中找到：

```markdown
```bash
# 安装依赖
npm install

# 运行测试
npm test
```
```

替换为：

```markdown
```bash
# 安装依赖
npm install

# 检测原生依赖是否能正常加载
npm run check:native

# 运行测试
npm test
```
```

- [ ] **Step 2: 重写"原生依赖兼容性"章节**

在 `readme.md` 中找到：

```markdown
### 原生依赖兼容性

项目依赖 `better-sqlite3` 与 `tree-sitter` 两个带原生二进制（`.node`）的 npm 包。在某些 macOS 环境上，预编译二进制可能因签名或架构问题无法加载，表现为 `dlopen` 报错。

若遇到此类问题，尝试从源码重新编译：

```bash
# 修复 node-gyp-build 无执行权限（如 npm rebuild 报 126）
chmod +x node_modules/.bin/node-gyp-build

# 重新编译
npm rebuild better-sqlite3
npm rebuild tree-sitter
npm rebuild tree-sitter-typescript
npm rebuild tree-sitter-javascript
npm rebuild tree-sitter-python
```
```

替换为：

```markdown
### 原生依赖兼容性

Nodus 依赖 `better-sqlite3` 与 `tree-sitter` 系列包，它们包含原生二进制（`.node`）。在某些 macOS 环境上，预编译二进制可能因签名或架构问题无法加载，表现为 `dlopen` 报错。

**快速诊断：**

```bash
npm run check:native
```

如果输出中有 ❌，请执行：

```bash
npm run rebuild:native
```

该命令会依次重新编译：

- `better-sqlite3`
- `tree-sitter`
- `tree-sitter-typescript`
- `tree-sitter-javascript`
- `tree-sitter-python`

Windows 用户请手动逐条运行：

```powershell
npm rebuild better-sqlite3
npm rebuild tree-sitter
npm rebuild tree-sitter-typescript
npm rebuild tree-sitter-javascript
npm rebuild tree-sitter-python
```

重建后再运行：

```bash
npm run check:native
npm test
```

如果仍失败，请检查：

1. Node.js 版本是否符合 `package.json` 的 `engines` 要求。
2. 是否已安装 Xcode Command Line Tools（macOS）或 Python + Visual Studio Build Tools（Windows）。
3. `node-gyp` 是否有网络问题导致无法下载头文件；可配置 `npm config set python python3` 与代理。
```

- [ ] **Step 3: 运行 check 与 test 确认文档指引有效**

Run:
```bash
npm run check:native
npm test
```

Expected:
- `check:native` 全绿
- `npm test` 全绿

- [ ] **Step 4: Commit**

```bash
git add readme.md
git commit -m "docs(readme): update native dependency troubleshooting with new scripts"
```

---

## Self-Review

**1. Spec coverage:**
- R1.1 要求"解决 `better-sqlite3` / `tree-sitter` 在部分平台因签名/架构无法加载的问题；提供 `npm rebuild` 指引或预编译脚本" → Task 1/2/3/5 覆盖诊断、rebuild 脚本与文档。
- R1.1 要求"提供 `npm rebuild` 指引" → Task 5 在 README 中给出跨平台指引。
- 没有引入新的运行时依赖；仅使用 npm 与 node-gyp。

**2. Placeholder scan:**
- 无 TBD/TODO/fill in details。
- 每个步骤包含完整代码或命令。
- 测试代码完整，包含断言与错误信息。

**3. Type consistency:**
- 脚本使用 ESM `import`，与项目一致。
- 测试文件路径与命名风格与现有 `src/common/*.test.ts` 一致。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-01-native-binary-compatibility.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
