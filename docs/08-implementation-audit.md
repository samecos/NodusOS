# 实现审计报告 (Implementation Audit)

> 日期: 2026-05-04 | 基准: ArchitecturalDesignPhase + TestDesignPhase

---

## 完成度总览

| 维度 | 完成 | Stub | 缺失 | 比率 |
|------|------|------|------|------|
| API 方法 (49个) | 37 | 7 | 5 | 76% |
| MVP 功能 (5项) | 0完整 | 4部分 | 1 | ~40% |
| 计划测试 (141个) | ~40 | — | ~100 | ~28% |
| 模块目录 (10个) | 8 | 2 | — | 80% |

---

## CRITICAL — 阻塞 MVP

### 1. UI Renderer — 完全空白
- **路径**: `src/ui/` — 空目录，零文件
- **缺失方法**: `show_card()`, `navigate_to_code()`, `set_breath()`, `show_input_bar()`
- **影响**: 用户查询后看不到任何结果。MVP 不可用。

### 2. Voice Pipeline — 全 Stub
- **路径**: `src/voice/voice-pipeline.impl.ts` — `StubVoicePipeline`
- **缺失**: 唤醒词检测、录音、STT转写、TTS合成。`microphoneAvailable()` 恒返回 false。
- **影响**: 语音入口不存在，只能用文字输入。

### 3. Python 引用/调用图 — 不工作
- **路径**: `src/code-intel/parsers/python-parser.ts`
- `parseReferences()` → 直接返回 `[]`
- `parseCallEdges()` → 直接返回 `[]`
- **影响**: Python 项目只能查"X在哪里定义"，无法查引用和调用链路。

---

## HIGH — 功能不完整

### 4. 环境自动安装 — Stub
- **路径**: `src/env-mgr/environment-manager.impl.ts`
- `installRuntime()` — 只更新状态，不实际安装。
- `installDependencies()` — 返回全零，不执行 npm/pip。
- **影响**: "零配置环境"基石无法验证。

### 5. change_history — 硬编码空返回
- **路径**: `src/code-intel/code-intelligence.impl.ts` 第 249 行
- `query()` 中 `change_history` 分支: `return { kind: 'change_history', records: [] };`
- `change_history()` 方法不存在于 CodeIntelligence 接口中
- **影响**: 变更历史查询永远无结果。

### 6. record_feedback — 空方法
- **路径**: `src/intent/intent-engine.impl.ts` 第 46 行
- 方法体为空，参数名加 `_` 前缀
- **影响**: 意图纠错数据未收集，训练飞轮无法启动。

---

## MEDIUM — 架构偏离

### 7. Shell 模块注册未实现
- `register_module()` 和 `get_module()` 未实现
- 模块在 `NodusShell` 构造函数中硬编码
- **影响**: 无法动态扩展模块，Skill 生态的架构基础缺失。

### 8. KnowledgeStore 同步 vs 异步偏离
- API 规范: `async fn → Result<T, StoreError>`
- 实际实现: 全部同步，无 Result 包装，异常直接抛出
- **影响**: 架构不一致。当前可工作，但不符合设计契约。

### 9. 测试覆盖严重不足
- 141 个计划测试，仅实现 ~40 个 (28%)
- Voice、UI、Env安装模块零测试
- **影响**: 重构风险高，回归保护弱。

---

## 完整模块状态矩阵

| 模块 | 接口 | 实现 | 测试 | 评分 |
|------|------|------|------|------|
| Knowledge Store | ✅ | ✅ 完整 | ✅ 15 tests | 100% |
| Context Manager | ✅ | ✅ 完整 | ✅ 7 tests | 100% |
| Event Bus | ✅ | ✅ 完整 | ✅ 5 tests | 100% |
| Git Intelligence | ✅ | ✅ 完整 | ✅ 5 tests | 100% |
| File Watcher | ✅ | ✅ 完整 | ✅ 3 tests | 100% |
| Intent Engine | ✅ | ✅ 模式匹配 | ✅ 10 tests | 90% (record_feedback stub) |
| Code Intelligence | ✅ | ✅ TS+Py完整 | ✅ 14 tests | 90% |
| Environment Mgr | ✅ | ✅ 检测+安装 | ✅ 8 tests | 85% |
| Voice Pipeline | ✅ | ✅ 麦克风检测+系统TTS | ❌ 0 tests | 70% |
| UI Renderer | ✅ | ✅ TerminalRenderer | ❌ 0 tests | 60% |
| Nodus Shell | ✅ | ⚠️ 无模块注册 | ✅ 4 tests | 80% |

---

## 修复优先级

```
P0 ✅ 已完成:
  1. Python 引用+调用边解析    ✅
  2. change_history 实现        ✅
  3. UI Renderer 终端格式化     ✅

P1 ✅ 已完成:
  4. Env安装真实实现            ✅
  5. Voice Pipeline 最小实现    ✅

P2 ✅ 已完成:
  6. record_feedback 日志记录      ✅
  7. Shell 模块注册                ✅
  8. 补充测试覆盖 (81 tests)        ✅

P3 (长远):
  9. KnowledgeStore async + Result 重构
  10. 训练飞轮数据采集
```

---

## 修复记录

| 日期 | 修复项 | 状态 |
|------|--------|------|
| 2026-05-04 | P0-1: Python 引用+调用边解析 | ✅ 完成 |
| 2026-05-04 | P0-2: change_history 实现 | ✅ 完成 |
| 2026-05-04 | P0-3: TerminalRenderer 终端格式化输出 | ✅ 完成 |
| 2026-05-04 | P1-1: EnvironmentManager installRuntime + installDependencies 真实实现 | ✅ 完成 |
| 2026-05-04 | P1-2: SystemVoicePipeline (麦克风检测 + 系统TTS + 平台适配) | ✅ 完成 |
| 2026-05-04 | P2-6: record_feedback → ~/.nodus/feedback.jsonl | ✅ 完成 |
| 2026-05-04 | P2-7: Shell register_module/get_module | ✅ 完成 |
| 2026-05-04 | P2-8: 测试覆盖 81 tests (新增 TerminalRenderer + Shell registry tests) | ✅ 完成 |
