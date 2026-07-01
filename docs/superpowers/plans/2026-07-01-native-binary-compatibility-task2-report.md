# Task 2 Report: 统一 Rebuild 脚本

## 任务目标

创建 `scripts/rebuild-native-deps.js`，为 Nodus 项目的关键原生依赖（better-sqlite3、tree-sitter 及其语言 grammar）提供一键重新编译能力，解决预编译二进制在 macOS 等平台上因签名/架构问题无法加载的兼容性故障。

## 已完成工作

1. 创建 `scripts/rebuild-native-deps.js`
   - 使用 ESM 模块语法，与项目 `"type": "module"` 保持一致。
   - 列出 5 个关键原生依赖：
     - `better-sqlite3`
     - `tree-sitter`
     - `tree-sitter-typescript`
     - `tree-sitter-javascript`
     - `tree-sitter-python`
   - Windows 平台降级为提示用户手动在 PowerShell 中执行 `npm rebuild <pkg>`。
   - 非 Windows 平台先尝试为 `node_modules/.bin/node-gyp-build` 添加执行权限，再逐个 `npm rebuild`。
   - 每个包的编译结果以 ✅ / ❌ 标记输出；最终根据是否有失败返回退出码 0 或 1。
2. 赋予脚本可执行权限：`chmod +x scripts/rebuild-native-deps.js`。
3. 运行 rebuild 脚本并成功重新编译全部 5 个包。
4. 使用 Task 1 的 `scripts/check-native-deps.js` 验证：全部 5 个原生依赖均可正常加载。
5. 运行完整测试套件：`npm test` 160/160 通过。
6. 按任务要求提交 commit。

## 验证结果

### rebuild 脚本输出

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

### 原生依赖加载检测

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

### 测试套件结果

```
 Test Files  17 passed (17)
      Tests  160 passed (160)
   Start at  22:46:23
   Duration  1.43s
```

> 备注： rebuild 前项目存在 15 个 `knowledge-store.test.ts` 失败及若干 tree-sitter 相关测试套件无法运行；重新编译原生模块后全部恢复。

## Commit

- **Hash:** `7f3ae15`
- **Message:** `feat(scripts): add unified native dependency rebuild script`
- **变更文件：** `scripts/rebuild-native-deps.js`

## 依赖与约束遵守情况

- ✅ 仅新增脚本文件，未修改 `scripts/check-native-deps.js`。
- ✅ 未引入新的运行时依赖。
- ✅ 脚本跨平台处理：Windows 给出手动命令提示并退出；类 Unix 系统自动执行。
- ✅ 修改后 `npm test` 160 个测试全绿。

## 已知问题 / 注意事项

- 脚本输出提示用户运行 `npm run check:native`，但当前 `package.json` 尚未配置 `check:native` / `rebuild:native` 脚本。用户目前可直接运行 `node scripts/check-native-deps.js` 和 `node scripts/rebuild-native-deps.js`。
- Windows 分支仅打印手动命令，不会自动执行编译。
- rebuild 过程依赖本地 `node-gyp` 工具链及对应语言的编译环境（如 Python、C++ 编译器）。
