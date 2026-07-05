import type { Context, ContextDelta, ContextManager, RecentQuery } from './context-manager.js';
import type { IntentType } from '../common/types.js';

const MAX_RECENT_QUERIES = 5;

export class DefaultContextManager implements ContextManager {
  private state: Context;
  private listeners: Array<(delta: ContextDelta) => void> = [];

  constructor(projectRoot: string) {
    this.state = {
      active_file: null,
      cursor_line: null,
      cursor_col: null,
      cursor_symbol: null,
      cursor_symbol_kind: null,
      selected_code: null,
      selected_range: null,
      recent_queries: [],
      active_project_root: projectRoot,
    };
  }

  snapshot(): Context {
    return { ...this.state, recent_queries: [...this.state.recent_queries] };
  }

  update(delta: ContextDelta): void {
    switch (delta.kind) {
      case 'file_opened':
        this.state.active_file = delta.path;
        break;
      case 'file_closed':
        if (this.state.active_file === delta.path) {
          this.state.active_file = null;
          this.state.cursor_line = null;
          this.state.cursor_col = null;
          this.state.cursor_symbol = null;
          this.state.cursor_symbol_kind = null;
        }
        break;
      case 'cursor_moved':
        // 只在当前活动文件中追踪光标
        if (this.state.active_file === delta.file || !this.state.active_file) {
          this.state.active_file = delta.file;
          this.state.cursor_line = delta.line;
          this.state.cursor_col = delta.col;
          this.state.cursor_symbol = delta.symbol;
          this.state.cursor_symbol_kind = delta.symbol_kind ?? null;
        }
        break;
      case 'selection_changed':
        this.state.selected_code = delta.code;
        this.state.selected_range = delta.range;
        break;
      case 'project_changed':
        this.state = {
          active_file: null,
          cursor_line: null,
          cursor_col: null,
          cursor_symbol: null,
          cursor_symbol_kind: null,
          selected_code: null,
          selected_range: null,
          recent_queries: this.state.recent_queries,
          active_project_root: delta.root,
        };
        break;
    }

    // 通知监听者
    for (const listener of this.listeners) {
      listener(delta);
    }
  }

  recordQuery(text: string, intentType: IntentType | null): void {
    const entry: RecentQuery = {
      text,
      intent_type: intentType,
      timestamp: new Date().toISOString(),
    };
    this.state.recent_queries = [entry, ...this.state.recent_queries].slice(0, MAX_RECENT_QUERIES);
  }

  onChange(handler: (delta: ContextDelta) => void): () => void {
    this.listeners.push(handler);
    return () => {
      const idx = this.listeners.indexOf(handler);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }
}
