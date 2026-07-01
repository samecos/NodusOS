# Task 3 Report: 在 package.json 中注册命令

## 任务目标

在 `package.json` 的 `scripts` 字段中注册两个 npm 命令：

- `npm run check:native` → 调用 `scripts/check-native-deps.js`
- `npm run rebuild:native` → 调用 `scripts/rebuild-native-deps.js`

## 修改内容

**文件：** `package.json`

在 `scripts` 块末尾新增两条命令（保留原有 scripts 不变）：

```json
"check:native": "node scripts/check-native-deps.js",
"rebuild:native": "node scripts/rebuild-native-deps.js"
```

完整 `scripts` 字段如下：

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "typecheck": "tsc --noEmit",
  "dev": "tsx src/main.ts",
  "build": "tsc",
  "package": "npm run build && node scripts/package.js",
  "run:pkg": "node bundle/dist/main.js",
  "check:native": "node scripts/check-native-deps.js",
  "rebuild:native": "node scripts/rebuild-native-deps.js"
}
```

## 验证结果

### 1. `npm run check:native`

退出码：0

输出摘要：

```
[check-native-deps] Platform: darwin
[check-native-deps] Node: v22.22.3

✅ better-sqlite3: default export present
✅ tree-sitter: default export present
✅ tree-sitter-typescript: default export present
✅ tree-sitter-javascript: default export present
✅ tree-sitter-python: default export present

[check-native-deps] All native dependencies loaded successfully.
```

### 2. `npm run rebuild:native`

退出码：0

输出摘要：

```
[rebuild-native-deps] Rebuilding better-sqlite3...
rebuilt dependencies successfully
[rebuild-native-deps] ✅ better-sqlite3 rebuilt
[rebuild-native-deps] Rebuilding tree-sitter...
rebuilt dependencies successfully
[rebuild-native-deps] ✅ tree-sitter rebuilt
[rebuild-native-deps] Rebuilding tree-sitter-typescript...
rebuilt dependencies successfully
[rebuild-native-deps] ✅ tree-sitter-typescript rebuilt
[rebuild-native-deps] Rebuilding tree-sitter-javascript...
rebuilt dependencies successfully
[rebuild-native-deps] ✅ tree-sitter-javascript rebuilt
[rebuild-native-deps] Rebuilding tree-sitter-python...
rebuilt dependencies successfully
[rebuild-native-deps] ✅ tree-sitter-python rebuilt

[rebuild-native-deps] All packages rebuilt. Run `npm run check:native` to verify.
```

### 3. `npm test`

退出码：0

结果：

```
Test Files  17 passed (17)
     Tests  160 passed (160)
```

## Git Commit

```
51891c0 chore(package): add check:native and rebuild:native scripts
```

## 结论

Task 3 已完成。`package.json` 中成功注册了两个 npm scripts，命令执行正常，完整测试套件 160/160 通过。
