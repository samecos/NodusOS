import type { BaseEvent, EventBus, EventHandler, Subscription } from './event-bus.js';

export class SimpleEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  emit(event: BaseEvent): void {
    const kind = event.kind;
    const handlers = this.handlers.get(kind);
    if (!handlers) return;

    for (const handler of handlers) {
      handler(event);
    }
  }

  on(kind: string, handler: EventHandler): Subscription {
    if (!this.handlers.has(kind)) {
      this.handlers.set(kind, new Set());
    }
    const handlers = this.handlers.get(kind)!;
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
    };
  }

  clear(): void {
    this.handlers.clear();
  }
}
