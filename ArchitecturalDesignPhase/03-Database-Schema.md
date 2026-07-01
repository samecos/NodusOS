# Nodus 数据库设计文档 (Database Schema Design)

> 版本: v1.0 | 日期: 2026-05-04

---

## 1. 概述

### 1.1 数据库选型

| 属性 | 值 |
|------|-----|
| DBMS | SQLite 3.42+ |
| 存储路径 | `~/.nodus/nodus.db` |
| 访问模式 | WAL (Write-Ahead Logging) |
| 连接池 | 单连接 + tokio::sync::Mutex |
| 字符集 | UTF-8 |
| 兼容目标 | SQLite 向后兼容至 3.35 |

### 1.2 设计原则

1. **最小化 JOIN** — 高频查询走单表或简单 JOIN，避免 3 表以上联查
2. **ID 为内容哈希** — 符号和引用的主键由内容计算，支持幂等 upsert
3. **JSON 用于半结构化数据** — 语言列表、标注标签等用 JSON 文本存储
4. **外键用于数据完整性** — 级联删除确保引用一致性
5. **时间戳使用 ISO 8601 文本** — SQLite 无原生 datetime 类型，用 TEXT 存储

---

## 2. 实体关系图 (ERD)

```
┌──────────────────────┐          ┌──────────────────────────┐
│      projects        │          │   project_runtimes       │
├──────────────────────┤          ├──────────────────────────┤
│ PK  id INTEGER       │──┐       │ PK  id INTEGER           │
│ UQ  root_path TEXT   │  │       │ FK  project_id → projects│──┐
│     name TEXT        │  │       │     language TEXT        │  │
│     languages JSON   │  │       │     version_constraint   │  │
│     framework TEXT   │  │       │     installed_version    │  │
│     created_at TEXT  │  │       │     specified_in TEXT    │  │
│     updated_at TEXT  │  │       └──────────────────────────┘  │
└──────────────────────┘  │                                      │
                          │  ┌──────────────────────────┐       │
                          │  │  project_dependencies    │       │
                          │  ├──────────────────────────┤       │
                          │  │ PK  id INTEGER           │       │
                          ├──│ FK  project_id → projects│       │
                          │  │     name TEXT            │       │
                          │  │     version TEXT         │       │
                          │  │     dep_type TEXT        │       │
                          │  │     language TEXT        │       │
                          │  └──────────────────────────┘       │
                          │                                      │
┌──────────────────────┐  │                                      │
│      symbols         │  │                                      │
├──────────────────────┤  │                                      │
│ PK  id TEXT (hash)   │  │                                      │
│     name TEXT        │  │                                      │
│     kind TEXT        │  │                                      │
│     language TEXT    │  │                                      │
│     file_path TEXT   │──┼──────────────────────────────────────┘
│     line_start INT   │  │  (间接关联: file_path 属于某个 project root)
│     line_end INT     │  │
│     col_start INT    │  │
│     col_end INT      │  │
│ FK? parent_id→symbols│  │
│     is_exported INT  │  │
│     signature TEXT   │  │
│     doc_comment TEXT │  │
│     file_checksum    │  │
│     updated_at TEXT  │  │
└─────────┬────────────┘  │
          │                │
          │ source_symbol  │ target_symbol
          ▼                ▼
┌──────────────────────────────────────┐
│           references                 │
├──────────────────────────────────────┤
│ PK  id TEXT (hash)                   │
│ FK  source_symbol_id → symbols(id)  │
│ FK  target_symbol_id → symbols(id)  │
│     file_path TEXT                   │
│     line INTEGER                     │
│     col INTEGER                      │
│     kind TEXT                        │
│     updated_at TEXT                  │
└──────────────────────────────────────┘

┌──────────────────────┐    ┌──────────────────────┐
│  file_index_state    │    │    query_history      │
├──────────────────────┤    ├──────────────────────┤
│ PK  file_path TEXT   │    │ PK  id INTEGER        │
│     checksum TEXT    │    │     raw_text TEXT     │
│     symbol_count INT │    │     intent_type TEXT  │
│     indexed_at TEXT  │    │     entities JSON     │
│     error TEXT       │    │     context_file TEXT │
└──────────────────────┘    │     context_symbol    │
                            │     confidence REAL   │
┌──────────────────────┐    │     latency_ms INT    │
│  user_preferences    │    │     result_count INT  │
├──────────────────────┤    │     timestamp TEXT    │
│ PK  key TEXT         │    └──────────────────────┘
│     value JSON       │
│     updated_at TEXT  │    ┌──────────────────────┐
└──────────────────────┘    │  annotations (v2)     │
                            ├──────────────────────┤
                            │ PK  id INTEGER        │
                            │     ai_code TEXT      │
                            │     human_code TEXT   │
                            │     diff TEXT         │
                            │     symbols JSON      │
                            │     tags JSON         │
                            │     created_at TEXT   │
                            └──────────────────────┘

   ───→  外键关联 (FOREIGN KEY REFERENCES)
   ─ ─→  间接关联 (通过 file_path 字符串匹配)
```

**说明**：`symbols` 和 `projects` 之间没有直接外键，因为一个项目的索引可能来自多个项目路径，且符号表需要支持跨项目查询。关联通过 `file_path` 字符串前缀匹配实现。

---

## 3. 表详细定义

### 3.1 symbols — 符号表

存储从代码中提取的所有符号定义。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | TEXT | PK | 全局唯一ID = SHA256(file_path + name + kind + line_start) |
| `name` | TEXT | NOT NULL | 符号名称，如 `refundOrder` |
| `kind` | TEXT | NOT NULL | 符号种类 enum: function/method/class/interface/type/variable/parameter/module |
| `language` | TEXT | NOT NULL | 语言: typescript/javascript/python |
| `file_path` | TEXT | NOT NULL | 定义所在文件的绝对路径 |
| `line_start` | INTEGER | NOT NULL | 定义起始行 (1-based) |
| `line_end` | INTEGER | NOT NULL | 定义结束行 |
| `col_start` | INTEGER | NOT NULL | 定义起始列 (1-based) |
| `col_end` | INTEGER | NOT NULL | 定义结束列 |
| `parent_id` | TEXT | nullable | 父符号ID，如类方法指向类，顶层符号为 NULL |
| `is_exported` | INTEGER | NOT NULL, DEFAULT 0 | 是否从模块导出 |
| `signature` | TEXT | nullable | 函数/类型签名文本，如 `(orderId: string): Promise<RefundResult>` |
| `doc_comment` | TEXT | nullable | 文档注释，截断至 512 字符 |
| `file_checksum` | TEXT | NOT NULL | 文件内容 SHA256，用于增量索引时检测文件是否变更 |
| `updated_at` | TEXT | NOT NULL, DEFAULT datetime('now') | ISO 8601 时间戳 |

**查询频率预估**：
- `symbols_find_by_name`: 每用户查询 1-5次/会话
- `symbols_find_by_file`: 文件切换时 1次/文件
- `symbols_search`: 模糊搜索 0-2次/会话

### 3.2 references — 引用关系表

存储符号之间的引用关系。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | TEXT | PK | SHA256(source + target + file + line + col) |
| `source_symbol_id` | TEXT | NOT NULL, FK → symbols(id) | 引用方符号ID |
| `target_symbol_id` | TEXT | NOT NULL, FK → symbols(id) | 被引用方符号ID |
| `file_path` | TEXT | NOT NULL | 引用发生的文件路径 |
| `line` | INTEGER | NOT NULL | 引用所在行 |
| `col` | INTEGER | NOT NULL | 引用所在列 |
| `kind` | TEXT | NOT NULL | 引用类型: call/import/inheritance/type_use/instantiation/override |
| `updated_at` | TEXT | NOT NULL, DEFAULT datetime('now') | |

**注意**：目前未使用外键约束（SQLite 默认关闭），在应用层保证引用完整性。如需开启，执行 `PRAGMA foreign_keys = ON;`

### 3.3 file_index_state — 文件索引状态

追踪每个文件是否已被索引，用于增量更新判断。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `file_path` | TEXT | PK | 文件绝对路径 |
| `checksum` | TEXT | NOT NULL | 上次索引时的文件内容 SHA256 |
| `symbol_count` | INTEGER | NOT NULL, DEFAULT 0 | 该文件提取出的符号数 |
| `indexed_at` | TEXT | NOT NULL | 上次索引时间 |
| `error` | TEXT | nullable | 索引失败时的错误信息，NULL 表示成功 |

### 3.4 projects — 项目表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `root_path` | TEXT | UNIQUE NOT NULL | 项目根目录绝对路径 |
| `name` | TEXT | NOT NULL | 项目名称（从目录名或 package.json 提取） |
| `languages` | TEXT | NOT NULL | JSON 数组，如 `["typescript","python"]` |
| `framework` | TEXT | nullable | JSON 字符串，如 `"nextjs"` |
| `created_at` | TEXT | NOT NULL, DEFAULT datetime('now') | |
| `updated_at` | TEXT | NOT NULL, DEFAULT datetime('now') | |

### 3.5 project_runtimes — 项目运行时表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `project_id` | INTEGER | NOT NULL, FK → projects(id) ON DELETE CASCADE | |
| `language` | TEXT | NOT NULL | typescript/javascript/python |
| `version_constraint` | TEXT | NOT NULL | 版本约束，如 `">=18.0.0"`, `"~3.12"` |
| `installed_version` | TEXT | nullable | 当前已安装版本 |
| `specified_in` | TEXT | nullable | 约束来源文件，如 `"package.json"` |

UNIQUE(project_id, language)

### 3.6 project_dependencies — 项目依赖表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `project_id` | INTEGER | NOT NULL, FK → projects(id) ON DELETE CASCADE | |
| `name` | TEXT | NOT NULL | 包名 |
| `version` | TEXT | NOT NULL | 版本号 |
| `dep_type` | TEXT | NOT NULL | production/development/peer/optional |
| `language` | TEXT | NOT NULL | |

UNIQUE(project_id, name, dep_type)

### 3.7 user_preferences — 用户偏好表

KV 存储，key 为点分路径。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `key` | TEXT | PK | 如 `"voice.wake_word"`, `"ui.theme"` |
| `value` | TEXT | NOT NULL | JSON 值 |
| `updated_at` | TEXT | NOT NULL, DEFAULT datetime('now') | |

### 3.8 query_history — 查询历史表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `raw_text` | TEXT | NOT NULL | 用户原始输入文本 |
| `intent_type` | TEXT | nullable | 解析出的意图类型 |
| `entities` | TEXT | nullable | JSON，意图实体 |
| `context_file` | TEXT | nullable | 查询时的活跃文件 |
| `context_symbol` | TEXT | nullable | 查询时光标所在符号 |
| `confidence` | REAL | nullable | 意图解析置信度 |
| `latency_ms` | INTEGER | nullable | 查询总耗时（毫秒） |
| `result_count` | INTEGER | nullable | 返回结果数 |
| `timestamp` | TEXT | NOT NULL, DEFAULT datetime('now') | |

### 3.9 annotations — 训练标注表 (v2 预留)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `ai_generated_code` | TEXT | NOT NULL | AI 生成的代码 |
| `human_modified_code` | TEXT | NOT NULL | 人类修改后的代码 |
| `diff` | TEXT | NOT NULL | unified diff |
| `symbols_involved` | TEXT | nullable | JSON，涉及的符号ID列表 |
| `annotation_tags` | TEXT | nullable | JSON 标注标签，如 `["add_null_check","add_audit_log"]` |
| `created_at` | TEXT | NOT NULL, DEFAULT datetime('now') | |

---

## 4. 索引策略

### 4.1 索引清单

```sql
-- === symbols 表索引 ===

-- 名称查询: "getUserByEmail在哪里定义的"
CREATE INDEX idx_symbols_name ON symbols(name);

-- 文件查询: "payment.service.ts里有哪些函数"
CREATE INDEX idx_symbols_file ON symbols(file_path);

-- 按种类过滤: "列出所有class"
CREATE INDEX idx_symbols_kind ON symbols(kind);

-- 按语言过滤
CREATE INDEX idx_symbols_language ON symbols(language);

-- 父符号查询: "这个类的所有方法"
CREATE INDEX idx_symbols_parent ON symbols(parent_id);

-- 文件的符号列表（按种类分组）
CREATE INDEX idx_symbols_file_kind ON symbols(file_path, kind);

-- === references 表索引 ===

-- 引用查找: "refundOrder被哪些地方调用了" (最热查询)
CREATE INDEX idx_refs_target ON references(target_symbol_id);

-- 反向查找: "这个文件引用了哪些外部符号"
CREATE INDEX idx_refs_source ON references(source_symbol_id);

-- 文件引用: "这个文件里有哪些引用关系"
CREATE INDEX idx_refs_file ON references(file_path);

-- 引用类型过滤
CREATE INDEX idx_refs_kind ON references(kind);

-- === file_index_state 表索引 ===

-- 增量索引时 checksum 比较
CREATE INDEX idx_file_state_checksum ON file_index_state(checksum);

-- === query_history 表索引 ===

-- 最近查询
CREATE INDEX idx_query_hist_time ON query_history(timestamp);

-- 意图类型统计
CREATE INDEX idx_query_hist_intent ON query_history(intent_type);
```

### 4.2 索引覆盖的查询模式

| 查询模式 | 使用索引 | 预期行扫描 |
|---------|---------|-----------|
| "find_symbol(name)" | idx_symbols_name | 1-10 rows |
| "find_references(target_id)" | idx_refs_target | 1-50 rows |
| "symbols_in_file(path)" | idx_symbols_file | 10-200 rows |
| "call_graph(root_id, depth=3)" | idx_refs_target + idx_refs_source | 5-200 rows |
| "change_history(module_path)" | idx_symbols_file prefix + git log | N/A |
| "symbols_search(fuzzy)" | idx_symbols_name LIKE | 50-500 rows |

---

## 5. 存储容量估算

### 5.1 基准项目参数

| 参数 | 值 |
|------|-----|
| 基准项目规模 | 10,000 行代码 |
| 平均符号密度 | 1 符号 / 5 行代码 |
| 平均引用密度 | 2 引用 / 符号 |
| 平均符号名长度 | 20 字符 |
| 平均文件路径长度 | 80 字符 |

### 5.2 估算公式

```
10,000 行代码 → 2,000 个符号 → 4,000 条引用

symbols 表:
  每行: id(64) + name(20) + kind(10) + language(12) + file_path(80)
       + 4×INT(4×8) + parent_id(64) + is_exported(1) + signature(100)
       + doc_comment(50) + checksum(64) + updated_at(25)
     ≈ 550 bytes/row
  2,000 rows × 550 bytes ≈ 1.1 MB

references 表:
  每行: id(64) + source(64) + target(64) + file_path(80)
       + line(8) + col(8) + kind(12) + updated_at(25)
     ≈ 325 bytes/row
  4,000 rows × 325 bytes ≈ 1.3 MB

索引 (约为数据量的 30-50%):
  ≈ 1.0 MB

其他表 (projects, prefs, history, file_state):
  ≈ 0.5 MB

总计 10,000 行项目: ≈ 3.9 MB
```

### 5.3 不同规模项目估算

| 项目规模 | 符号数 | 引用数 | DB 大小 (估算) |
|---------|--------|--------|---------------|
| 1,000 行 | 200 | 400 | ~0.5 MB |
| 10,000 行 | 2,000 | 4,000 | ~4 MB |
| 50,000 行 | 10,000 | 20,000 | ~18 MB |
| 100,000 行 | 20,000 | 40,000 | ~35 MB |
| 500,000 行 | 100,000 | 200,000 | ~170 MB |

**结论**：10万行以内的项目（MVP目标），数据库 < 50MB，完全可以接受。

---

## 6. 迁移策略

### 6.1 版本管理

使用应用内嵌的迁移版本号，存储在 `user_preferences` 表中：

```sql
-- 检查当前 schema 版本
SELECT value FROM user_preferences WHERE key = 'system.schema_version';
```

### 6.2 迁移脚本模板

```rust
struct Migration {
    version: u32,
    description: &'static str,
    up: &'static str,
    down: Option<&'static str>,  // 回滚 SQL
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        description: "Initial schema",
        up: include_str!("migrations/001_initial.sql"),
        down: None,  // 初始版本不回滚
    },
    Migration {
        version: 2,
        description: "Add annotations table for training data",
        up: include_str!("migrations/002_annotations.sql"),
        down: Some("DROP TABLE IF EXISTS annotations;"),
    },
];
```

### 6.3 迁移执行流程

```
App Start
    │
    ▼
读取 current_version (从 user_preferences, 默认 0)
    │
    ▼
对每个 version > current_version 的 Migration:
    ├── BEGIN TRANSACTION
    ├── 执行 migration.up
    ├── 验证: 检查表是否存在、字段是否完整
    ├── 成功 → COMMIT, 更新 current_version
    └── 失败 → ROLLBACK, 记录错误, 使用旧版本继续
```

### 6.4 数据库重建策略

如果数据库损坏且无法修复：
1. 备份损坏的 DB 为 `nodus.db.corrupted.{timestamp}`
2. 创建新的空 DB，运行所有迁移
3. 重新索引所有已注册项目（从 `projects` 表中读取路径——但 projects 表在损坏的 DB 中）
4. 如果 `projects` 表也无法恢复，用户需要重新打开项目

**用户影响**：索引丢失但代码不受影响。重新索引自动后台完成。

---

## 7. 数据保留与清理

| 数据 | 保留策略 | 清理方式 |
|------|---------|---------|
| 符号和引用 | 与项目代码同步 | 文件删除时自动清理 |
| 查询历史 | 保留最近 90 天 | 启动时自动清理过期记录 |
| 用户偏好 | 永久保留 | 用户手动重置 |
| 项目元数据 | 手动删除项目时清理 | 应用内"移除项目"操作 |
| 日志文件 | 保留 7 天 | 按日轮转，自动删除 |
