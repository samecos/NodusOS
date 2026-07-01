# Nodus 测试计划 (Test Plan)

> 版本: v1.0 | 日期: 2026-05-04 | 方法论: TDD

---

## 1. 测试策略概述

### 1.1 TDD 工作流

Nodus 采用 **Red-Green-Refactor** 循环：

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  RED     │────→│  GREEN   │────→│ REFACTOR │
│ 写失败   │     │ 写最少   │     │ 重构代码  │
│ 的测试   │     │ 代码通过 │     │ 优化结构  │
└──────────┘     └──────────┘     └──────────┘
     ↑                                  │
     └──────────────────────────────────┘
             下一轮循环
```

**铁律**：
1. 没有失败的测试，不写产品代码
2. 只写让测试通过的最少代码
3. 测试通过后立即重构

### 1.2 测试金字塔

```
                   ┌───────┐
                   │  E2E  │   ~10 tests   (用户场景验收)
                   │ 10%   │
                  ┌┴───────┴┐
                  │Integration│ ~40 tests  (跨模块边界)
                  │   25%    │
                 ┌┴──────────┴┐
                 │  Unit Tests │ ~150 tests (模块内部逻辑)
                 │    65%     │
                └┴────────────┴┘
```

### 1.3 测试范围总览

| 测试层级 | 目标 | 数量预估 | 覆盖模块 |
|---------|------|---------|---------|
| **单元测试** | 每个函数/方法的行为正确性 | 150+ | 全部10个模块 |
| **集成测试** | 跨模块接口契约和交互正确性 | 40+ | 模块间 + EventBus + KnowledgeStore |
| **确认测试** | 端到端用户场景完整走通 | 10+ | 6条用户旅程 |
| **性能测试** | 关键路径延迟达标 | 5 | 索引、查询、环境就绪 |
| **压力测试** | 大项目和大查询的稳定性 | 3 | 10万行代码项目 |

---

## 2. TDD 开发节奏

### 2.1 模块开发顺序

```
Phase 1: 基础设施
  ├── Knowledge Store    (数据层，无依赖)
  ├── Context Manager    (无依赖)
  └── Event Bus          (无依赖)

Phase 2: 能力模块
  ├── File Watcher       (无依赖，依赖Event Bus)
  ├── Git Intelligence   (无依赖)
  ├── Environment Manager(无依赖)
  └── Code Intelligence  (依赖 KnowledgeStore)

Phase 3: 编排模块
  ├── Intent Engine      (依赖 ContextManager)
  └── Voice Pipeline     (无依赖)

Phase 4: 界面模块
  ├── UI Renderer        (依赖所有能力模块接口)
  └── Nodus Shell        (依赖所有模块)
```

每个模块按 TDD 节奏：先写接口 trait → 写单元测试 → 写实现 → 测试通过 → 重构。

### 2.2 测试先行示例

以 `KnowledgeStore::symbols_upsert` 为例：

```
1. RED:   定义 trait，写测试：
          #[test]
          fn test_upsert_single_symbol() {
              let store = KnowledgeStore::new_in_memory();
              let sym = Symbol { name: "foo", ... };
              let count = store.symbols_upsert(&[sym]).await.unwrap();
              assert_eq!(count, 1);
          }
          → 编译失败: KnowledgeStore 尚未实现

2. GREEN: 实现 symbols_upsert，连接 SQLite，
          运行测试 → PASS

3. REFACTOR: 优化 SQL，添加批量插入优化
          运行测试 → 仍然 PASS
```

---

## 3. 测试环境

### 3.1 环境矩阵

| 环境 | 用途 | 数据 |
|------|------|------|
| **开发环境** | TDD 红绿重构循环 | 临时 SQLite :memory: 或 tmp 文件 |
| **CI 环境** | 每次 push 自动运行 | 临时 SQLite，空项目 |
| **本地集成** | 提交前完整验证 | 真实项目目录（测试fixture） |
| **性能环境** | 性能基准测试 | 生成的 10 万行代码项目 |

### 3.2 测试 Fixture

准备以下测试项目：

| Fixture | 规模 | 用途 |
|---------|------|------|
| `tiny-project` | 3 files, 50 symbols | 单元测试（高频使用） |
| `medium-project` | 50 files, 2,000 symbols | 集成测试 |
| `large-project` | 500 files, 20,000 symbols | 性能测试 |
| `multi-lang-project` | TS + Python 混合 | 多语言测试 |
| `broken-project` | 含语法错误文件 | 错误处理/降级测试 |
| `non-git-project` | 无 .git 目录 | 降级行为测试 |

### 3.3 Mock 策略

| 依赖 | Mock方式 | 适用测试层级 |
|------|---------|------------|
| SQLite | `rusqlite` in-memory DB | 单元测试 |
| 文件系统 | tempfile crate 临时目录 | 单元+集成 |
| Git CLI | 预置的 git repo fixture | 集成测试 |
| 系统语音API | Mock trait 实现 | 单元测试 |
| tree-sitter | 真实解析器（无 mock） | 所有层级 |
| 网络(npm/pip) | Offline mock registry | 集成测试 |

---

## 4. 测试框架与工具

| 层级 | Rust 侧 | Web前端侧 |
|------|---------|----------|
| 单元测试 | `#[test]` + `rstest` (参数化) | Vitest |
| 集成测试 | `tests/` 目录 + `test-case` | Vitest + React Testing Library |
| Mock | `mockall` crate | vi.mock() |
| 断言 | `assert_eq!` + `pretty_assertions` | expect().toEqual() |
| 覆盖率 | cargo-llvm-cov (target: ≥85%) | c8 / istanbul |
| CI | GitHub Actions | 同 |

---

## 5. 质量门禁

### 5.1 代码提交前 (Pre-commit)

- [ ] 所有单元测试通过（`cargo test`）
- [ ] 相关模块的集成测试通过
- [ ] `cargo clippy` 无警告
- [ ] `cargo fmt` 已执行

### 5.2 PR 合并前 (Pre-merge)

- [ ] CI 全量测试通过（含集成+确认测试）
- [ ] 代码覆盖率 ≥ 85%（新增代码 ≥ 90%）
- [ ] 性能基准测试不退化（关键路径延迟波动 < 10%）
- [ ] 至少1人代码审查通过

### 5.3 发布前 (Pre-release)

- [ ] 全部确认测试（10条用户旅程）通过
- [ ] 10万行代码项目索引和查询性能达标
- [ ] 作者本人持续使用一周无阻塞性问题

---

## 6. 测试度量

| 指标 | 目标值 | 测量方式 |
|------|--------|---------|
| 行覆盖率 | ≥ 85% | cargo-llvm-cov |
| 分支覆盖率 | ≥ 80% | cargo-llvm-cov |
| 单元测试通过率 | 100% | CI |
| 集成测试通过率 | 100% | CI |
| 确认测试通过率 | 100% | 手动+自动化 |
| TDD 遵守率 | 每个功能从测试开始 | Code Review |
| 测试执行速度(单元) | < 10s (150+ tests) | cargo test 计时 |
| 测试执行速度(全量) | < 120s | CI 计时 |

---

## 7. 风险管理

| 风险 | 缓解措施 |
|------|---------|
| tree-sitter 解析结果不稳定 | 对 10 个真实开源项目建立 golden test suite |
| 语音识别在不同环境下差异大 | Mock 语音输入，确保下游逻辑独立于语音来源 |
| 异步测试不稳定（flaky） | tokio::test + 合理超时设置 + 避免依赖真实网络 |
| 大项目索引时间不可预测 | 建立性能基准测试，检测回归 |
| TDD 纪律松弛 | PR Review Checklist 检查测试是否先行 |
