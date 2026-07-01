// ============================================================
// EventBus 单元测试 — TC-UT-EB-001 ~ TC-UT-EB-004
// ============================================================

import { describe, it, expect } from 'vitest';
import { SimpleEventBus } from './event-bus.impl.js';
import type { ProjectOpenedEvent, FileChangedEvent, VoiceTranscribedEvent } from './event-bus.js';

describe('SimpleEventBus', () => {
  // TC-UT-EB-001: 应分发同类型事件给订阅者
  it('TC-UT-EB-001: should dispatch events to subscribers', () => {
    const bus = new SimpleEventBus();
    const received: ProjectOpenedEvent[] = [];

    bus.on('project:opened', (event) => {
      received.push(event);
    });

    const event: ProjectOpenedEvent = {
      kind: 'project:opened',
      root: '/tmp/project',
      meta: {
        name: 'test',
        root_path: '/tmp/project',
        languages: ['typescript'],
        runtimes: [],
        dependencies: [],
      },
    };

    bus.emit(event);
    expect(received).toHaveLength(1);
    expect(received[0]!.root).toBe('/tmp/project');
  });

  // TC-UT-EB-002: 取消订阅后不应再收到事件
  it('TC-UT-EB-002: should allow unsubscribing', () => {
    const bus = new SimpleEventBus();
    const received: FileChangedEvent[] = [];

    const unsubscribe = bus.on('file:changed', (event) => {
      received.push(event);
    });

    bus.emit({ kind: 'file:changed', path: 'src/a.ts', change_type: 'modified' });
    unsubscribe();
    bus.emit({ kind: 'file:changed', path: 'src/b.ts', change_type: 'created' });

    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe('src/a.ts');
  });

  // TC-UT-EB-003: clear 应移除所有订阅
  it('TC-UT-EB-003: should clear all subscriptions', () => {
    const bus = new SimpleEventBus();
    let count = 0;

    bus.on('voice:transcribed', () => count++);
    bus.emit({ kind: 'voice:transcribed', text: 'hello' });
    bus.clear();
    bus.emit({ kind: 'voice:transcribed', text: 'world' });

    expect(count).toBe(1);
  });

  // TC-UT-EB-004: 未订阅事件应静默忽略
  it('TC-UT-EB-004: should ignore events with no subscribers', () => {
    const bus = new SimpleEventBus();
    expect(() => bus.emit({ kind: 'voice:transcribed', text: 'test' })).not.toThrow();
  });
});
