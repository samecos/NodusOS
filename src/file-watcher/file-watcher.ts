// ============================================================
// FileWatcher — 文件系统变更监听
// ============================================================

import type { EventBus } from '../shell/event-bus.js';

export type ChangeType = 'created' | 'modified' | 'deleted' | 'renamed';

export interface FileChangeEvent {
  path: string;
  changeType: ChangeType;
}

export interface FileWatcher {
  watch(path: string, patterns: string[]): Promise<void>;
  unwatch(path: string): Promise<void>;
  pause(): void;
  resume(): void;
}
