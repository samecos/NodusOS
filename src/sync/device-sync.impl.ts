// ============================================================
// DefaultDeviceSync — 多设备同步实现
// ============================================================

import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { SyncData, QueryHistoryEntry, ProjectMeta, SessionState } from '../common/types.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { DeviceSync, SyncOptions, SyncResult } from './device-sync.js';

const SYNC_DATA_VERSION = 1;

export class DefaultDeviceSync implements DeviceSync {
  private feedbackPath: string;

  constructor(
    private store: KnowledgeStore,
    feedbackPath?: string,
  ) {
    this.feedbackPath = feedbackPath ?? join(homedir(), '.nodus', 'feedback.jsonl');
  }

  // ========== 导出 ==========

  exportSyncData(options: SyncOptions = {}): SyncData {
    const deviceId = options.deviceId ?? this.generateDeviceId();
    const since = options.since;

    // 查询历史（支持增量）
    let queryHistory: QueryHistoryEntry[] = this.store.historyRecent(10000);
    if (since) {
      queryHistory = queryHistory.filter(e => e.timestamp > since);
    }

    // 偏好
    const preferences = this.store.prefList();

    // 项目列表
    const projects = this.store.projectList();

    // 会话状态（支持增量）
    let sessionStates: SessionState[] = [];
    for (const project of projects) {
      const state = this.store.sessionStateGet(project.root_path);
      if (state) {
        sessionStates.push(state);
      }
    }
    if (since) {
      sessionStates = sessionStates.filter(s => (s.updated_at ?? '') > since);
    }

    // 反馈数据
    let feedbackEntries: string[] = [];
    if (options.includeFeedback !== false) {
      feedbackEntries = this.readFeedbackEntries();
    }

    return {
      version: SYNC_DATA_VERSION,
      deviceId,
      exportedAt: new Date().toISOString(),
      queryHistory,
      preferences,
      projects,
      sessionStates,
      feedbackEntries,
    };
  }

  // ========== 导入 ==========

  importSyncData(data: SyncData, options: { merge?: boolean } = {}): SyncResult {
    const merge = options.merge !== false;
    const result: SyncResult = {
      success: true,
      syncedAt: new Date().toISOString(),
      stats: {
        queryHistoryAdded: 0,
        queryHistorySkipped: 0,
        preferencesUpdated: 0,
        projectsAdded: 0,
        projectsUpdated: 0,
        sessionStatesAdded: 0,
        sessionStatesUpdated: 0,
        feedbackEntriesAdded: 0,
      },
      errors: [],
    };

    if (data.version !== SYNC_DATA_VERSION) {
      result.errors.push(`同步数据版本不匹配: 期望 ${SYNC_DATA_VERSION}, 实际 ${data.version}`);
      result.success = false;
      return result;
    }

    try {
      this.importQueryHistory(data.queryHistory, merge, result);
      this.importPreferences(data.preferences, merge, result);
      this.importProjects(data.projects, merge, result);
      this.importSessionStates(data.sessionStates, merge, result);
      this.importFeedbackEntries(data.feedbackEntries, result);
    } catch (err) {
      result.success = false;
      result.errors.push(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    return result;
  }

  // ========== 完整同步流程 ==========

  sync(remoteData: SyncData, options: SyncOptions = {}): SyncResult {
    const localData = this.exportSyncData(options);
    const mergedData = this.mergeSyncData(localData, remoteData);
    // 合并后的数据已经是去重的完整数据集，使用 merge 模式安全导入
    return this.importSyncData(mergedData, { merge: true });
  }

  // ========== 内部辅助 ==========

  private generateDeviceId(): string {
    return `nodus-${process.platform}-${Date.now().toString(36)}`;
  }

  private readFeedbackEntries(): string[] {
    if (!existsSync(this.feedbackPath)) return [];
    try {
      const content = readFileSync(this.feedbackPath, 'utf-8').trim();
      if (!content) return [];
      return content.split('\n').filter(line => line.trim().length > 0);
    } catch {
      return [];
    }
  }

  private importQueryHistory(
    entries: QueryHistoryEntry[],
    merge: boolean,
    result: SyncResult,
  ): void {
    if (!merge) {
      for (const entry of entries) {
        this.store.historyRecord(entry);
        result.stats.queryHistoryAdded++;
      }
      return;
    }

    const existing = this.store.historyRecent(10000);
    const existingKeys = new Set(existing.map(e => `${e.raw_text}|${e.timestamp}`));

    for (const entry of entries) {
      const key = `${entry.raw_text}|${entry.timestamp}`;
      if (existingKeys.has(key)) {
        result.stats.queryHistorySkipped++;
      } else {
        this.store.historyRecord(entry);
        result.stats.queryHistoryAdded++;
        existingKeys.add(key);
      }
    }
  }

  private importPreferences(
    prefs: Record<string, unknown>,
    merge: boolean,
    result: SyncResult,
  ): void {
    if (!merge) {
      const existing = this.store.prefList();
      for (const key of Object.keys(existing)) {
        if (!(key in prefs)) {
          this.store.prefDelete(key);
        }
      }
    }

    for (const [key, value] of Object.entries(prefs)) {
      this.store.prefSet(key, value);
      result.stats.preferencesUpdated++;
    }
  }

  private importProjects(
    projects: ProjectMeta[],
    merge: boolean,
    result: SyncResult,
  ): void {
    for (const project of projects) {
      const existing = this.store.projectGet(project.root_path);
      this.store.projectUpsertFull(project);
      if (merge) {
        if (existing) {
          result.stats.projectsUpdated++;
        } else {
          result.stats.projectsAdded++;
        }
      } else {
        result.stats.projectsUpdated++;
      }
    }
  }

  private importSessionStates(
    states: SessionState[],
    merge: boolean,
    result: SyncResult,
  ): void {
    for (const state of states) {
      const existing = this.store.sessionStateGet(state.project_root);
      if (!merge || !existing) {
        this.store.sessionStateUpsert(state);
        result.stats.sessionStatesAdded++;
        continue;
      }

      const remoteTime = state.updated_at ?? '1970-01-01T00:00:00Z';
      const localTime = existing.updated_at ?? '1970-01-01T00:00:00Z';
      if (remoteTime > localTime) {
        this.store.sessionStateUpsert(state);
        result.stats.sessionStatesUpdated++;
      }
    }
  }

  private importFeedbackEntries(entries: string[], result: SyncResult): void {
    if (entries.length === 0) return;

    const existing = new Set(this.readFeedbackEntries());
    const dir = dirname(this.feedbackPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    for (const entry of entries) {
      if (existing.has(entry)) continue;
      try {
        appendFileSync(this.feedbackPath, entry + '\n', 'utf-8');
        result.stats.feedbackEntriesAdded++;
        existing.add(entry);
      } catch (err) {
        result.errors.push(`写入反馈失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private mergeSyncData(local: SyncData, remote: SyncData): SyncData {
    // queryHistory: 合并去重
    const historyMap = new Map<string, QueryHistoryEntry>();
    for (const entry of local.queryHistory) {
      historyMap.set(`${entry.raw_text}|${entry.timestamp}`, entry);
    }
    for (const entry of remote.queryHistory) {
      const key = `${entry.raw_text}|${entry.timestamp}`;
      if (!historyMap.has(key)) {
        historyMap.set(key, entry);
      }
    }

    // preferences: 远程优先
    const mergedPrefs = { ...local.preferences, ...remote.preferences };

    // projects: 远程优先
    const projectMap = new Map<string, ProjectMeta>();
    for (const p of local.projects) projectMap.set(p.root_path, p);
    for (const p of remote.projects) projectMap.set(p.root_path, p);

    // sessionStates: 取较新的
    const stateMap = new Map<string, SessionState>();
    for (const s of local.sessionStates) stateMap.set(s.project_root, s);
    for (const s of remote.sessionStates) {
      const localState = stateMap.get(s.project_root);
      if (!localState) {
        stateMap.set(s.project_root, s);
      } else {
        const localTime = localState.updated_at ?? '1970-01-01T00:00:00Z';
        const remoteTime = s.updated_at ?? '1970-01-01T00:00:00Z';
        if (remoteTime > localTime) {
          stateMap.set(s.project_root, s);
        }
      }
    }

    // feedback: 合并去重
    const feedbackSet = new Set([...local.feedbackEntries, ...remote.feedbackEntries]);

    return {
      version: SYNC_DATA_VERSION,
      deviceId: remote.deviceId,
      exportedAt: new Date().toISOString(),
      queryHistory: Array.from(historyMap.values()),
      preferences: mergedPrefs,
      projects: Array.from(projectMap.values()),
      sessionStates: Array.from(stateMap.values()),
      feedbackEntries: Array.from(feedbackSet),
    };
  }
}
