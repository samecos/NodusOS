# Task 4: 新增原生依赖加载测试

**Files:**
- Create: `src/common/native-deps.test.ts`
- Test: `npm test -- src/common/native-deps.test.ts`

**Interfaces:**
- Produces: Vitest 测试用例，加载失败时给出明确修复提示

## Steps

### Step 1: 编写测试

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

### Step 2: 运行新测试

Run:
```bash
npm test -- src/common/native-deps.test.ts
```

Expected:
```
 ✓ src/common/native-deps.test.ts (5 tests)
```

### Step 3: 运行完整测试套件

Run:
```bash
npm test
```

Expected: `Test Files 18 passed (18) / Tests 165 passed (165)`（新增 5 个测试）

### Step 4: Commit

```bash
git add src/common/native-deps.test.ts
git commit -m "test(common): add native dependency loading tests"
```

## Global Constraints

- ESM 模块系统，`package.json` 中 `"type": "module"`
- TypeScript 严格模式，`verbatimModuleSyntax: true`
- 类型导入必须写 `import type { ... }`
- 不引入新的运行时依赖
- 修改后完整测试套件仍须全绿
