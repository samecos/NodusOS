// ============================================================
// EventBus — 模块间松散通信
// ============================================================

export interface BaseEvent {
  kind: string;
  [key: string]: unknown;
}

export type Subscription = () => void;
export type EventHandler = (event: BaseEvent) => void;

export interface EventBus {
  emit(event: BaseEvent): void;
  on(kind: string, handler: EventHandler): Subscription;
  clear(): void;
}
