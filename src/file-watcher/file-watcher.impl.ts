// ============================================================
// FileWatcher 实现 — Node.js fs.watch + debounce
// ============================================================

import { watch } from 'node:fs';
import { EventEmitter } from 'node:events';
import type { FileWatcher, FileChangeEvent, ChangeType } from './file-watcher.js';
import type { EventBus } from '../shell/event-bus.js';
import type { SimpleEventBus } from '../shell/event-bus.impl.js';

const DEBOUNCE_MS = 500;
const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.cache'];

export class FileWatcherImpl implements FileWatcher {
  private watchers = new Map<string, { watcher: ReturnType<typeof watch> }>();
  private pending = new Map<string, { changeType: ChangeType; timer: ReturnType<typeof setTimeout> }>();
  private paused = false;
  private patterns: string[] = [];
  private eventBus: EventBus;
  private emitter = new EventEmitter();

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  async watch(path: string, patterns: string[]): Promise<void> {
    this.patterns = patterns;
    const watcher = watch(path, { recursive: true }, (eventType, filename) => {
      if (this.paused || !filename) return;
      const normalized = filename.replace(/\\/g, '/');
      if (IGNORE_DIRS.some(d => normalized.includes(`/${d}/`) || normalized.startsWith(`${d}/`))) return;
      if (!this.matchesPattern(filename)) return;

      const fullPath = `${path}/${filename}`;
      const changeType: ChangeType = eventType === 'rename' ? 'deleted' : 'modified';

      // debounce
      const existing = this.pending.get(fullPath);
      if (existing) {
        clearTimeout(existing.timer);
      }

      const timer = setTimeout(() => {
        this.pending.delete(fullPath);
        this.eventBus.emit({
          kind: 'file:changed',
          path: fullPath,
          change_type: changeType,
        });
        this.emitter.emit('change', { path: fullPath, changeType });
      }, DEBOUNCE_MS);

      this.pending.set(fullPath, { changeType, timer });
    });

    this.watchers.set(path, { watcher });
  }

  async unwatch(path: string): Promise<void> {
    const entry = this.watchers.get(path);
    if (entry) {
      entry.watcher.close();
      this.watchers.delete(path);
    }
  }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }

  onChange(handler: (event: FileChangeEvent) => void): () => void {
    this.emitter.on('change', handler);
    return () => this.emitter.off('change', handler);
  }

  private matchesPattern(filename: string): boolean {
    if (this.patterns.length === 0) return true;
    return this.patterns.some(p => {
      if (p.startsWith('**/')) return filename.endsWith(p.slice(3));
      if (p.startsWith('*.')) return filename.endsWith(p.slice(1));
      return filename === p;
    });
  }
}
