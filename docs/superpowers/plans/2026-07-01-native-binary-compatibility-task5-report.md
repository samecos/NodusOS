# Task 5 报告：更新 README 原生依赖兼容性章节

## 任务目标

根据 `2026-07-01-native-binary-compatibility-task5-brief.md`，更新 `readme.md`：

1. 在 Quick Start 中增加 `npm run check:native` 步骤。
2. 重写"原生依赖兼容性"章节，引用新的 `check:native` / `rebuild:native` 命令。
3. 运行 `npm run check:native` 与 `npm test` 确认文档指引有效。
4. 提交变更。

## 修改内容

### 修改文件：`readme.md`

#### 1. Quick Start 测试说明

将：

```bash
# 安装依赖
npm install

# 运行测试（当前：160 个测试，全绿）
npm test
```

替换为：

```bash
# 安装依赖
npm install

# 检测原生依赖是否能正常加载
npm run check:native

# 运行测试
npm test
```

#### 2. 原生依赖兼容性章节

将原章节（手动 `npm rebuild` 各包、附带 `chmod +x` 提示）替换为新章节，包含：

- 快速诊断命令：`npm run check:native`
- 一键修复命令：`npm run rebuild:native`
- 重新编译的包清单
- Windows 用户手动逐条命令
- 修复后验证步骤：`npm run check:native` + `npm test`
- 进一步排查清单（Node 版本、构建工具、node-gyp 网络/代理）

## 验证结果

### `npm run check:native`

```text
[check-native-deps] Platform: darwin
[check-native-deps] Node: v22.22.3

✅ better-sqlite3: default export present
✅ tree-sitter: default export present
✅ tree-sitter-typescript: default export present
✅ tree-sitter-javascript: default export present
✅ tree-sitter-python: default export present

[check-native-deps] All native dependencies loaded successfully.
```

### `npm test`

```text
 Test Files  18 passed (18)
      Tests  165 passed (165)
   Duration  1.41s
```

## 提交信息

- **Hash:** `e2f9a89d93fee2c205b32dc70cdad5d0ba0de3af`
- **Message:** `docs(readme): update native dependency troubleshooting with new scripts`

## 结论

任务已完成。README 的 Quick Start 与原生依赖兼容性章节均已更新为指向新的 `check:native` 与 `rebuild:native` 脚本，且验证命令全部通过。
