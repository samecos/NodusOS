// ============================================================
// EventBus — 模块间松散通信
// 定义标准事件类型，所有跨模块事件应使用 NodusEvent 联合类型。
// ============================================================

import type { ProjectMeta } from '../common/types.js';
import type { QueryResult } from '../code-intel/code-intelligence.js';
import type { NodusError } from '../common/errors.js';
import type { NodusConfig } from '../common/config.js';

// ---- 标准事件定义 ----

export interface ConfigChangedEvent {
  kind: 'config:changed';
  config: NodusConfig;
}

export interface ProjectOpenedEvent {
  kind: 'project:opened';
  root: string;
  meta: ProjectMeta;
}

export interface EnvReadyEvent {
  kind: 'env:ready';
  meta: ProjectMeta;
}

export interface IndexReadyEvent {
  kind: 'index:ready';
  symbol_count: number;
  duration_ms: number;
}

export interface FileChangedEvent {
  kind: 'file:changed';
  path: string;
  change_type: 'created' | 'modified';
}

export interface FileDeletedEvent {
  kind: 'file:deleted';
  path: string;
}

export interface VoiceTranscribedEvent {
  kind: 'voice:transcribed';
  text: string;
}

export interface VoiceSilentModeToggledEvent {
  kind: 'voice:silent_mode_toggled';
  silent: boolean;
}

export interface QueryReceivedEvent {
  kind: 'query:received';
  text: string;
}

export interface QueryResultEvent {
  kind: 'query:result';
  result: QueryResult;
}

export interface ErrorEvent {
  kind: 'error';
  module: string;
  error: NodusError;
}

/** 所有标准事件的联合类型 */
export type NodusEvent =
  | ConfigChangedEvent
  | ProjectOpenedEvent
  | EnvReadyEvent
  | IndexReadyEvent
  | FileChangedEvent
  | FileDeletedEvent
  | VoiceTranscribedEvent
  | VoiceSilentModeToggledEvent
  | QueryReceivedEvent
  | QueryResultEvent
  | ErrorEvent;

export type EventKind = NodusEvent['kind'];

export type EventHandler<E extends NodusEvent = NodusEvent> = (event: E) => void;

export interface EventBus {
  emit<E extends NodusEvent>(event: E): void;
  on<K extends EventKind>(kind: K, handler: EventHandler<Extract<NodusEvent, { kind: K }>>): () => void;
  clear(): void;
}
