# Task 3: 在 package.json 中注册命令

**Files:**
- Modify: `package.json`（`scripts` 字段）
- Test: 运行 `npm run check:native` 和 `npm run rebuild:native`

**Interfaces:**
- Produces: `npm run check:native` 调用 `scripts/check-native-deps.js`
- Produces: `npm run rebuild:native` 调用 `scripts/rebuild-native-deps.js`

## Steps

### Step 1: 添加 scripts

在 `package.json` 的 `scripts` 字段中新增：

```json
"check:native": "node scripts/check-native-deps.js",
"rebuild:native": "node scripts/rebuild-native-deps.js",
```

保持其他 scripts 不变。

### Step 2: 验证命令

Run:
```bash
npm run check:native
npm run rebuild:native
```

Expected:
- `check:native` 输出全部 ✅，退出码 0
- `rebuild:native` 成功重新编译（或提示已是最新），退出码 0

### Step 3: 运行完整测试套件

Run:
```bash
npm test
```

Expected: `Test Files 17 passed (17) / Tests 160 passed (160)`

### Step 4: Commit

```bash
git add package.json
git commit -m "chore(package): add check:native and rebuild:native scripts"
```

## Global Constraints

- ESM 模块系统，`package.json` 中 `"type": "module"`
- 不引入新的运行时依赖
- 修改后 `npm test` 仍须 160 个测试全绿
