// ============================================================
// VoicePipeline 单元测试
// TC-UT-VP-001 ~ TC-UT-VP-008
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { SystemVoicePipeline } from './voice-pipeline.impl.js';
import { SimpleEventBus } from '../shell/event-bus.impl.js';
import { MockSTTEngine } from './stt-engine.js';
import { MockWakeWordDetector } from './wake-word-detector.js';
import type { AudioRecorder } from './audio-recorder.js';

class MockAudioRecorder implements AudioRecorder {
  private availableFlag = true;
  private lastRecordingPath: string | null = null;

  setAvailable(available: boolean): void {
    this.availableFlag = available;
  }

  getLastRecordingPath(): string | null {
    return this.lastRecordingPath;
  }

  available(): boolean {
    return this.availableFlag;
  }

  record(_durationMs: number): string {
    this.lastRecordingPath = '/tmp/mock-recording.wav';
    return this.lastRecordingPath;
  }
}

describe('SystemVoicePipeline', () => {
  let eventBus: SimpleEventBus;
  let recorder: MockAudioRecorder;
  let stt: MockSTTEngine;
  let wakeWord: MockWakeWordDetector;
  let pipeline: SystemVoicePipeline;

  beforeEach(() => {
    eventBus = new SimpleEventBus();
    recorder = new MockAudioRecorder();
    stt = new MockSTTEngine();
    wakeWord = new MockWakeWordDetector();
    pipeline = new SystemVoicePipeline(eventBus, {
      audioRecorder: recorder,
      sttEngine: stt,
      wakeWordDetector: wakeWord,
    });
  });

  // TC-UT-VP-001: 启动/停止不抛异常
  it('TC-UT-VP-001: should start and stop without error', async () => {
    await expect(pipeline.start()).resolves.toBeUndefined();
    expect(pipeline.microphoneAvailable()).toBe(true);
    await expect(pipeline.stop()).resolves.toBeUndefined();
  });

  // TC-UT-VP-002: 静音模式切换
  it('TC-UT-VP-002: should toggle silent mode', () => {
    const events: unknown[] = [];
    eventBus.on('voice:silent_mode_toggled', (e) => events.push(e));

    pipeline.setSilentMode(true);
    expect(events.length).toBe(1);
    expect((events[0] as { silent: boolean }).silent).toBe(true);

    pipeline.setSilentMode(false);
    expect(events.length).toBe(2);
    expect((events[1] as { silent: boolean }).silent).toBe(false);
  });

  // TC-UT-VP-003: 录音并转写
  it('TC-UT-VP-003: should record and transcribe audio', async () => {
    stt.setNextResult('refundOrder 在哪里定义的');
    const events: unknown[] = [];
    eventBus.on('voice:transcribed', (e) => events.push(e));

    const text = await pipeline.recordAndTranscribe(1000);

    expect(text).toBe('refundOrder 在哪里定义的');
    expect(recorder.getLastRecordingPath()).toBe('/tmp/mock-recording.wav');
    expect(events.length).toBe(1);
    expect((events[0] as { text: string }).text).toBe('refundOrder 在哪里定义的');
  });

  // TC-UT-VP-004: 麦克风不可用时录音报错
  it('TC-UT-VP-004: should throw when microphone is unavailable', async () => {
    recorder.setAvailable(false);
    await expect(pipeline.recordAndTranscribe(1000)).rejects.toThrow('Microphone not available');
  });

  // TC-UT-VP-005: 唤醒词检测
  it('TC-UT-VP-005: should delegate wake word detection', async () => {
    wakeWord.setNextResult(true);
    const result = await pipeline.checkWakeWord('/tmp/test.wav');
    expect(result).toBe(true);
  });

  // TC-UT-VP-006: speak 不抛异常（无实际音频输出验证）
  it('TC-UT-VP-006: should speak without throwing', async () => {
    await expect(pipeline.speak('hello')).resolves.toBeUndefined();
  });

  // TC-UT-VP-007: 唤醒词检测 → 录音 → 转写完整流程
  it('TC-UT-VP-007: should detect wake word, record and transcribe in loop', async () => {
    wakeWord.setNextResultOnce(true);
    stt.setNextResult('refundOrder 在哪里定义的');

    const events: unknown[] = [];
    eventBus.on('voice:transcribed', (e) => events.push(e));

    await pipeline.start();

    // 等待循环执行一次唤醒流程（Mock 组件都是瞬间返回的，200ms 足够）
    await new Promise((resolve) => setTimeout(resolve, 300));

    await pipeline.stop();

    expect(events.length).toBe(1);
    expect((events[0] as { text: string }).text).toBe('refundOrder 在哪里定义的');
    expect(wakeWord.getDetectCount()).toBeGreaterThanOrEqual(1);
    expect(recorder.getLastRecordingPath()).toBe('/tmp/mock-recording.wav');
  });

  // TC-UT-VP-008: 静音模式下不启动监听循环
  it('TC-UT-VP-008: should not start listen loop in silent mode', async () => {
    pipeline.setSilentMode(true);
    await pipeline.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await pipeline.stop();
    expect(wakeWord.getDetectCount()).toBe(0);
  });
});
