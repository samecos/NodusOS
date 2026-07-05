// ============================================================
// DeviceSync 单元测试 — TC-UT-SYNC-001 ~ TC-UT-SYNC-012
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { DefaultDeviceSync } from './device-sync.impl.js';
import type { SyncData, QueryHistoryEntry, ProjectMeta, SessionState } from '../common/types.js';

describe('DeviceSync', () => {
  let store: SqliteKnowledgeStore;
  let sync: DefaultDeviceSync;
  let feedbackDir: string;
  let feedbackPath: string;

  beforeEach(() => {
    store = new SqliteKnowledgeStore(':memory:');
    feedbackDir = mkdtempSync(join(tmpdir(), 'nodus-sync-test-'));
    feedbackPath = join(feedbackDir, 'feedback.jsonl');
    sync = new DefaultDeviceSync(store, feedbackPath);
  });

  // ==========================================================
  // TC-UT-SYNC-001: 导出同步数据包应包含全部数据类型
  // ==========================================================
  it('TC-UT-SYNC-001: exportSyncData should include all data types', () => {
    // 准备数据
    store.historyRecord({ raw_text: 'q1', latency_ms: 100, result_count: 1, timestamp: new Date().toISOString() });
    store.prefSet('theme', 'dark');
    store.projectUpsert({ name: 'p1', root_path: '/tmp/p1', languages: ['typescript'], runtimes: [], dependencies: [] });
    store.sessionStateUpsert({ project_root: '/tmp/p1', active_file: 'src/a.ts', cursor_line: 1, cursor_col: 1, cursor_symbol: null });
    writeFileSync(feedbackPath, '{"text":"good"}\n', 'utf-8');

    const data = sync.exportSyncData();

    expect(data.version).toBe(1);
    expect(data.deviceId).toMatch(/^nodus-/);
    expect(data.queryHistory).toHaveLength(1);
    expect(data.preferences).toEqual({ theme: 'dark' });
    expect(data.projects).toHaveLength(1);
    expect(data.sessionStates).toHaveLength(1);
    expect(data.feedbackEntries).toHaveLength(1);
  });

  // ==========================================================
  // TC-UT-SYNC-002: 增量导出应过滤旧数据
  // ==========================================================
  it('TC-UT-SYNC-002: incremental export should filter by since', () => {
    const oldTime = '2024-01-01T00:00:00Z';
    const newTime = '2025-01-01T00:00:00Z';

    store.historyRecord({ raw_text: 'old', latency_ms: 100, result_count: 1, timestamp: oldTime });
    store.historyRecord({ raw_text: 'new', latency_ms: 100, result_count: 1, timestamp: newTime });

    const data = sync.exportSyncData({ since: '2024-06-01T00:00:00Z' });
    expect(data.queryHistory).toHaveLength(1);
    expect(data.queryHistory[0].raw_text).toBe('new');
  });

  // ==========================================================
  // TC-UT-SYNC-003: 导入并合并数据
  // ==========================================================
  it('TC-UT-SYNC-003: importSyncData should merge data by default', () => {
    // 本地已有数据
    store.historyRecord({ raw_text: 'local', latency_ms: 100, result_count: 1, timestamp: '2025-01-01T00:00:00Z' });
    store.prefSet('theme', 'dark');

    const remote: SyncData = {
      version: 1,
      deviceId: 'remote-device',
      exportedAt: '2025-01-02T00:00:00Z',
      queryHistory: [{ raw_text: 'remote', latency_ms: 100, result_count: 1, timestamp: '2025-01-02T00:00:00Z' }],
      preferences: { fontSize: 14 },
      projects: [{ name: 'remote-p', root_path: '/tmp/rp', languages: ['typescript'], runtimes: [], dependencies: [] }],
      sessionStates: [],
      feedbackEntries: ['{"entry":1}'],
    };

    const result = sync.importSyncData(remote);

    expect(result.success).toBe(true);
    expect(result.stats.queryHistoryAdded).toBe(1);
    expect(result.stats.preferencesUpdated).toBe(1);
    expect(result.stats.projectsAdded).toBe(1);

    // 验证本地数据已合并
    expect(store.historyRecent(10)).toHaveLength(2);
    expect(store.prefGet('theme')).toBe('dark');
    expect(store.prefGet('fontSize')).toBe(14);
  });

  // ==========================================================
  // TC-UT-SYNC-004: 覆盖模式应替换本地数据
  // ==========================================================
  it('TC-UT-SYNC-004: overwrite mode should replace local data', () => {
    store.historyRecord({ raw_text: 'local', latency_ms: 100, result_count: 1, timestamp: '2025-01-01T00:00:00Z' });
    store.prefSet('theme', 'dark');

    const remote: SyncData = {
      version: 1,
      deviceId: 'remote-device',
      exportedAt: '2025-01-02T00:00:00Z',
      queryHistory: [{ raw_text: 'remote-only', latency_ms: 100, result_count: 1, timestamp: '2025-01-02T00:00:00Z' }],
      preferences: { fontSize: 14 },
      projects: [],
      sessionStates: [],
      feedbackEntries: [],
    };

    sync.importSyncData(remote, { merge: false });

    // 覆盖模式下，本地独有的 theme 偏好应被删除
    expect(store.prefGet('theme')).toBeUndefined();
    expect(store.prefGet('fontSize')).toBe(14);
  });

  // ==========================================================
  // TC-UT-SYNC-005: 完整同步流程（双向合并）
  // ==========================================================
  it('TC-UT-SYNC-005: sync should bidirectionally merge local and remote', () => {
    store.historyRecord({ raw_text: 'local', latency_ms: 100, result_count: 1, timestamp: '2025-01-01T00:00:00Z' });
    store.prefSet('theme', 'dark');

    const remote: SyncData = {
      version: 1,
      deviceId: 'remote-device',
      exportedAt: '2025-01-02T00:00:00Z',
      queryHistory: [{ raw_text: 'remote', latency_ms: 100, result_count: 1, timestamp: '2025-01-02T00:00:00Z' }],
      preferences: { fontSize: 14 },
      projects: [],
      sessionStates: [],
      feedbackEntries: [],
    };

    const result = sync.sync(remote);

    expect(result.success).toBe(true);
    const history = store.historyRecent(10);
    expect(history).toHaveLength(2);
    expect(store.prefGet('theme')).toBe('dark');
    expect(store.prefGet('fontSize')).toBe(14);
  });

  // ==========================================================
  // TC-UT-SYNC-006: 查询历史去重
  // ==========================================================
  it('TC-UT-SYNC-006: queryHistory should deduplicate on merge', () => {
    store.historyRecord({ raw_text: 'same', latency_ms: 100, result_count: 1, timestamp: '2025-01-01T00:00:00Z' });

    const remote: SyncData = {
      version: 1,
      deviceId: 'remote-device',
      exportedAt: '2025-01-02T00:00:00Z',
      queryHistory: [{ raw_text: 'same', latency_ms: 100, result_count: 1, timestamp: '2025-01-01T00:00:00Z' }],
      preferences: {},
      projects: [],
      sessionStates: [],
      feedbackEntries: [],
    };

    const result = sync.importSyncData(remote, { merge: true });
    expect(result.stats.queryHistorySkipped).toBe(1);
    expect(result.stats.queryHistoryAdded).toBe(0);
    expect(store.historyRecent(10)).toHaveLength(1);
  });

  // ==========================================================
  // TC-UT-SYNC-007: 会话状态按更新时间合并
  // ==========================================================
  it('TC-UT-SYNC-007: sessionStates should merge by updated_at', () => {
    store.sessionStateUpsert({
      project_root: '/tmp/p1',
      active_file: 'src/old.ts',
      cursor_line: 1,
      cursor_col: 1,
      cursor_symbol: null,
      updated_at: '2025-01-01T00:00:00Z',
    });

    const remote: SyncData = {
      version: 1,
      deviceId: 'remote-device',
      exportedAt: '2025-01-02T00:00:00Z',
      queryHistory: [],
      preferences: {},
      projects: [],
      sessionStates: [{
        project_root: '/tmp/p1',
        active_file: 'src/new.ts',
        cursor_line: 10,
        cursor_col: 5,
        cursor_symbol: 'foo',
        updated_at: '2025-01-02T00:00:00Z',
      }],
      feedbackEntries: [],
    };

    sync.importSyncData(remote, { merge: true });

    const state = store.sessionStateGet('/tmp/p1');
    expect(state!.active_file).toBe('src/new.ts');
    expect(state!.cursor_line).toBe(10);
  });

  // ==========================================================
  // TC-UT-SYNC-008: 反馈数据去重追加
  // ==========================================================
  it('TC-UT-SYNC-008: feedbackEntries should deduplicate and append', () => {
    writeFileSync(feedbackPath, '{"old":true}\n', 'utf-8');

    const remote: SyncData = {
      version: 1,
      deviceId: 'remote-device',
      exportedAt: '2025-01-02T00:00:00Z',
      queryHistory: [],
      preferences: {},
      projects: [],
      sessionStates: [],
      feedbackEntries: ['{"old":true}', '{"new":true}'],
    };

    const result = sync.importSyncData(remote, { merge: true });

    expect(result.stats.feedbackEntriesAdded).toBe(1);
    const content = readFileSync(feedbackPath, 'utf-8').trim().split('\n');
    expect(content).toHaveLength(2);
  });

  // ==========================================================
  // TC-UT-SYNC-009: 版本不匹配应拒绝导入
  // ==========================================================
  it('TC-UT-SYNC-009: should reject incompatible version', () => {
    const badData: SyncData = {
      version: 999,
      deviceId: 'bad',
      exportedAt: '2025-01-01T00:00:00Z',
      queryHistory: [],
      preferences: {},
      projects: [],
      sessionStates: [],
      feedbackEntries: [],
    };

    const result = sync.importSyncData(badData);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('版本不匹配'))).toBe(true);
  });

  // ==========================================================
  // TC-UT-SYNC-010: 项目列表合并
  // ==========================================================
  it('TC-UT-SYNC-010: projects should merge by root_path', () => {
    store.projectUpsert({ name: 'old', root_path: '/tmp/p1', languages: ['typescript'], runtimes: [], dependencies: [] });

    const remote: SyncData = {
      version: 1,
      deviceId: 'remote-device',
      exportedAt: '2025-01-02T00:00:00Z',
      queryHistory: [],
      preferences: {},
      projects: [{ name: 'updated', root_path: '/tmp/p1', languages: ['javascript'], runtimes: [], dependencies: [] }],
      sessionStates: [],
      feedbackEntries: [],
    };

    const result = sync.importSyncData(remote, { merge: true });
    expect(result.stats.projectsUpdated).toBe(1);

    const project = store.projectGet('/tmp/p1');
    expect(project!.name).toBe('updated');
    expect(project!.languages).toEqual(['javascript']);
  });

  // ==========================================================
  // TC-UT-SYNC-011: 新增项目应被识别为 added
  // ==========================================================
  it('TC-UT-SYNC-011: new projects should be counted as added', () => {
    const remote: SyncData = {
      version: 1,
      deviceId: 'remote-device',
      exportedAt: '2025-01-02T00:00:00Z',
      queryHistory: [],
      preferences: {},
      projects: [{ name: 'new', root_path: '/tmp/new', languages: ['python'], runtimes: [], dependencies: [] }],
      sessionStates: [],
      feedbackEntries: [],
    };

    const result = sync.importSyncData(remote, { merge: true });
    expect(result.stats.projectsAdded).toBe(1);
    expect(store.projectList()).toHaveLength(1);
  });

  // ==========================================================
  // TC-UT-SYNC-012: 排除反馈数据导出
  // ==========================================================
  it('TC-UT-SYNC-012: exportSyncData should exclude feedback when requested', () => {
    writeFileSync(feedbackPath, '{"entry":1}\n', 'utf-8');

    const data = sync.exportSyncData({ includeFeedback: false });
    expect(data.feedbackEntries).toHaveLength(0);
  });
});
