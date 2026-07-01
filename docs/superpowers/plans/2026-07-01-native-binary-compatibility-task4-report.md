# Task 4 报告：新增原生依赖加载测试

## 状态
DONE

## 变更内容
- 新建文件：`src/common/native-deps.test.ts`
- 新增 5 个 Vitest 测试用例，覆盖以下原生依赖的动态加载：
  - `better-sqlite3`
  - `tree-sitter`
  - `tree-sitter-typescript`
  - `tree-sitter-javascript`
  - `tree-sitter-python`
- 当加载失败时，测试会抛出包含明确修复提示的错误信息，引导用户运行 `npm run rebuild:native`。

## 测试执行结果

### 新测试文件
```bash
npm test -- src/common/native-deps.test.ts
```

```
Test Files  1 passed (1)
     Tests  5 passed (5)
```

### 完整测试套件
```bash
npm test
```

```
Test Files  18 passed (18)
     Tests  165 passed (165)
```

## Commit
- Hash: `11f5158`
- Message: `test(common): add native dependency loading tests`

## 约束检查
- ✅ 未引入新的运行时依赖
- ✅ 完整测试套件全绿
- ✅ 遵循 ESM + TypeScript 严格模式

## 关注点
None
