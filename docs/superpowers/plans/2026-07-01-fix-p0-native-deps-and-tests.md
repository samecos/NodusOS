# P0 问题修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 P0 级阻塞性问题（原生二进制加载失败 + 空测试文件），使 `npm test` 中 store、code-intel、shell 相关测试套件恢复正常运行。

**Architecture:** 优先通过从源码重新编译 `better-sqlite3` 和 `tree-sitter` 相关包解决 macOS 原生二进制签名/架构兼容性问题；在测试可运行后，为 `code-intel` 和 `nodus-shell` 补全真实测试用例。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、better-sqlite3、tree-sitter、tree-sitter-typescript、tree-sitter-javascript、tree-sitter-python

## Global Constraints

- 模块系统：ESM，`"type": "module"`，NodeNext 解析。
- TypeScript：严格模式，`verbatimModuleSyntax: true`，类型导入必须写 `import type`。
- 测试：使用 Vitest，单元测试放在 `src/<module>/<name>.test.ts`。
- 代码注释与文档主要使用中文。
- 不要修改现有通过测试的模块行为（context、intent、env-mgr、git-intel、file-watcher、ui、event-bus）。
- 每次完成一项任务后，更新 `readme.md` 中对应 TODO 的勾选状态，并同步更新 `npm test` 结果。

## File Structure

- `node_modules/better-sqlite3/` — 需要重新编译的原生依赖
- `node_modules/tree-sitter/`、`node_modules/tree-sitter-typescript/` 等 — 需要重新编译的原生依赖
- `src/store/knowledge-store.impl.ts` — SQLite 存储实现，依赖 better-sqlite3
- `src/store/knowledge-store.test.ts` — 已有 18 个测试用例，当前因 better-sqlite3 加载失败全部失败
- `src/code-intel/code-intelligence.test.ts` — 当前为空，导入 tree-sitter 即报错
- `src/code-intel/code-intelligence.integration.test.ts` — 当前为空
- `src/shell/nodus-shell.test.ts` — 当前为空
- `readme.md` — TODO list 与测试状态展示

---

### Task 1: 修复 better-sqlite3 原生二进制加载问题

**Files:**
- Modify: `readme.md`（完成后勾选 TODO）
- Test: `npm test -- src/store/knowledge-store.test.ts`

**Interfaces:**
- 不改变任何接口；仅修复运行时原生模块加载。

- [ ] **Step 1: 确认当前错误**

  运行：
  ```bash
  npm test -- src/store/knowledge-store.test.ts
  ```
  预期：报错 `dlopen(...better_sqlite3.node, 0x0001): ... slice is not valid mach-o file`。

- [ ] **Step 2: 重新编译 better-sqlite3**

  运行：
  ```bash
  npm rebuild better-sqlite3
  ```
  若 rebuild 成功则继续；若失败，尝试：
  ```bash
  cd node_modules/better-sqlite3 && npm run build-release
  ```

- [ ] **Step 3: 验证 store 测试**

  运行：
  ```bash
  npm test -- src/store/knowledge-store.test.ts
  ```
  预期：18 个测试全部通过。

- [ ] **Step 4: 更新 readme.md**

  将 `- [ ] 修复 better-sqlite3 ...` 改为 `- [x] 修复 better-sqlite3 ...`，并更新 Quick Start 中 `npm test` 的当前结果描述。

---

### Task 2: 修复 tree-sitter 原生二进制加载问题

**Files:**
- Modify: `readme.md`（完成后勾选 TODO）
- Test: `npm test -- src/code-intel/code-intelligence.test.ts`

**Interfaces:**
- 不改变任何接口；仅修复运行时原生模块加载。

- [ ] **Step 1: 确认当前错误**

  运行：
  ```bash
  npm test -- src/code-intel/code-intelligence.test.ts
  ```
  预期：报错 `dlopen(...tree-sitter-typescript.node, 0x0001): ... code signature ... not valid for use in process`。

- [ ] **Step 2: 重新编译 tree-sitter 相关包**

  依次运行：
  ```bash
  npm rebuild tree-sitter
  npm rebuild tree-sitter-typescript
  npm rebuild tree-sitter-javascript
  npm rebuild tree-sitter-python
  ```

- [ ] **Step 3: 验证 code-intel 测试套件可加载**

  运行：
  ```bash
  npm test -- src/code-intel/code-intelligence.test.ts
  ```
  预期：套件可以正常加载（即使测试用例为空或失败，也不再报 `dlopen` 错误）。

- [ ] **Step 4: 更新 readme.md**

  将 `- [ ] 修复 tree-sitter ...` 改为 `- [x] 修复 tree-sitter ...`。

---

### Task 3: 为 code-intelligence 补全单元测试

**Files:**
- Modify: `src/code-intel/code-intelligence.test.ts`
- Modify: `readme.md`（完成后勾选 TODO）
- Test: `npm test -- src/code-intel/code-intelligence.test.ts`

**Interfaces:**
- Consumes: `CodeIntelligenceImpl` 的 `indexProject`、`indexFile`、`findSymbol`、`findReferences`、`callGraph`、`impactAnalysis`、`query` 等方法。
- Produces: 一组覆盖核心索引与查询路径的单元测试。

- [ ] **Step 1: 准备测试夹具**

  在 `tests/fixtures/` 下确认或创建一个小型 TypeScript 项目（如 `tiny-project`），包含至少两个文件、若干函数、一次函数调用、一次 import。

- [ ] **Step 2: 编写测试用例**

  在 `src/code-intel/code-intelligence.test.ts` 中编写测试，覆盖：
  - `indexProject` 返回正确的文件数、符号数、引用数；
  - `findSymbol` 能按名称找到符号；
  - `findReferences` 能返回目标符号的引用；
  - `callGraph` 能生成调用图；
  - `impactAnalysis` 返回直接调用方列表；
  - `query` 对 `find_definition`、`find_references`、`call_graph` 意图返回正确结果。

- [ ] **Step 3: 运行并修复失败**

  运行：
  ```bash
  npm test -- src/code-intel/code-intelligence.test.ts
  ```
  预期：所有新测试通过。

- [ ] **Step 4: 更新 readme.md**

  将 `- [ ] 补全 code-intelligence.test.ts 单元测试` 改为 `- [x] ...`。

---

### Task 4: 为 code-intelligence 补全集成测试

**Files:**
- Modify: `src/code-intel/code-intelligence.integration.test.ts`
- Modify: `readme.md`（完成后勾选 TODO）
- Test: `npm test -- src/code-intel/code-intelligence.integration.test.ts`

**Interfaces:**
- Consumes: `CodeIntelligenceImpl` + `SqliteKnowledgeStore` + 测试夹具。
- Produces: 跨模块集成的端到端测试。

- [ ] **Step 1: 编写集成测试**

  覆盖：
  - 索引项目 → 符号落入 SQLite → 重启 `CodeIntelligenceImpl` 仍能查询；
  - 文件变更后调用 `indexFile` → 数据库中符号正确更新；
  - `FileWatcher` 触发文件变更事件 → `CodeIntelligence` 增量索引。

- [ ] **Step 2: 运行并修复失败**

  运行：
  ```bash
  npm test -- src/code-intel/code-intelligence.integration.test.ts
  ```
  预期：所有测试通过。

- [ ] **Step 3: 更新 readme.md**

  将 `- [ ] 补全 code-intelligence.integration.test.ts 集成测试` 改为 `- [x] ...`。

---

### Task 5: 为 nodus-shell 补全测试

**Files:**
- Modify: `src/shell/nodus-shell.test.ts`
- Modify: `readme.md`（完成后勾选 TODO）
- Test: `npm test -- src/shell/nodus-shell.test.ts`

**Interfaces:**
- Consumes: `NodusShell` 的生命周期方法 `bootstrap`、`openProject`、`handleQuery`、`handleQueryFormatted`、`shutdown`。
- Produces: 覆盖 NodusShell 初始化、项目打开、查询处理的测试。

- [ ] **Step 1: 编写测试用例**

  覆盖：
  - `bootstrap` 后各模块已初始化；
  - `openProject` 能检测项目类型并触发索引；
  - `handleQueryFormatted` 对简单定义查询返回非空字符串；
  - `shutdown` 后资源释放（不抛异常）。

- [ ] **Step 2: 运行并修复失败**

  运行：
  ```bash
  npm test -- src/shell/nodus-shell.test.ts
  ```
  预期：所有测试通过。

- [ ] **Step 3: 更新 readme.md**

  将 `- [ ] 补全 nodus-shell.test.ts 测试` 改为 `- [x] ...`。

---

## Self-Review

- **Spec coverage:** 计划覆盖了 readme.md 中全部 5 个 P0 TODO 项。
- **Placeholder scan:** 无 TBD/TODO，测试代码具体用例在实现时补充。
- **Type consistency:** 不涉及新的跨任务类型定义，使用现有接口。
- **依赖关系:** Task 1 和 Task 2 无依赖，可并行；Task 3/4/5 依赖 Task 2 完成后 tree-sitter 可加载。
