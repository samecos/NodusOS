import type { EventBus, EventHandler, NodusEvent, EventKind } from './event-bus.js';

export class SimpleEventBus implements EventBus {
  private handlers = new Map<EventKind, Set<EventHandler>>();

  emit(event: NodusEvent): void {
    const handlers = this.handlers.get(event.kind);
    if (!handlers) return;

    for (const handler of handlers) {
      (handler as EventHandler)(event);
    }
  }

  on<K extends EventKind>(kind: K, handler: EventHandler<Extract<NodusEvent, { kind: K }>>): () => void {
    if (!this.handlers.has(kind)) {
      this.handlers.set(kind, new Set());
    }
    const handlers = this.handlers.get(kind)!;
    handlers.add(handler as EventHandler);

    return () => {
      handlers.delete(handler as EventHandler);
    };
  }

  clear(): void {
    this.handlers.clear();
  }
}
