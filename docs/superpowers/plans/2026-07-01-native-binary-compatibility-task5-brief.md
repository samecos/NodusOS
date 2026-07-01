# Task 5: 更新 README 原生依赖兼容性章节

**Files:**
- Modify: `readme.md`
- Test: 运行 `npm run check:native` 和 `npm test`

**Interfaces:**
- Produces: README 中 Quick Start 增加 `npm run check:native` 步骤
- Produces: README 中"原生依赖兼容性"章节引用新的 `check:native` / `rebuild:native` 命令

## Steps

### Step 1: 更新 Quick Start 测试说明

在 `readme.md` 中找到：

```markdown
```bash
# 安装依赖
npm install

# 运行测试（当前：160 个测试，全绿）
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

### Step 2: 重写"原生依赖兼容性"章节

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

### Step 3: 运行 check 与 test 确认文档指引有效

Run:
```bash
npm run check:native
npm test
```

Expected:
- `check:native` 全绿
- `npm test` 全绿

### Step 4: Commit

```bash
git add readme.md
git commit -m "docs(readme): update native dependency troubleshooting with new scripts"
```

## Global Constraints

- 不引入新的运行时依赖
- 修改后 `npm test` 仍须全绿
