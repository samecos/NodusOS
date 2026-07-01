import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SimpleEventBus } from './event-bus.impl.js';

describe('EventBus', () => {
  let bus: SimpleEventBus;

  beforeEach(() => {
    bus = new SimpleEventBus();
  });

  it('should deliver events to subscribers', () => {
    const handler = vi.fn();
    bus.on('test:event', handler);

    bus.emit({ kind: 'test:event', payload: 'hello' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toMatchObject({ kind: 'test:event', payload: 'hello' });
  });

  it('should deliver to multiple subscribers', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    bus.on('test:event', handlerA);
    bus.on('test:event', handlerB);

    bus.emit({ kind: 'test:event' });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it('should allow unsubscription', () => {
    const handler = vi.fn();
    const unsub = bus.on('test:event', handler);
    bus.emit({ kind: 'test:event' });
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    bus.emit({ kind: 'test:event' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not cross-trigger different event types', () => {
    const handler = vi.fn();
    bus.on('test:event', handler);
    bus.emit({ kind: 'other:event' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should clear all subscriptions', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    bus.on('a', handlerA);
    bus.on('b', handlerB);
    bus.clear();
    bus.emit({ kind: 'a' });
    bus.emit({ kind: 'b' });
    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).not.toHaveBeenCalled();
  });
});
