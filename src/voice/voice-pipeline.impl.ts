// ============================================================
// VoicePipeline 实现 — 系统原生语音
// 启动常驻监听循环：录音短片段 → 检测唤醒词 → 录音 5s → STT → 发出事件
// ============================================================

import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import type { VoicePipeline } from './voice-pipeline.js';
import type { EventBus } from '../shell/event-bus.js';
import { SystemAudioRecorder } from './audio-recorder.js';
import { WhisperCliEngine, SystemSTTEngine, MockSTTEngine } from './stt-engine.js';
import { EnergyBasedWakeWordDetector, PorcupineWakeWordDetector, MockWakeWordDetector } from './wake-word-detector.js';
import { VoiceError } from '../common/errors.js';

export interface VoicePipelineDeps {
  audioRecorder?: import('./audio-recorder.js').AudioRecorder;
  sttEngine?: import('./stt-engine.js').STTEngine;
  wakeWordDetector?: import('./wake-word-detector.js').WakeWordDetector;
}

export class SystemVoicePipeline implements VoicePipeline {
  private silent = false;
  private listening = false;
  private isRunning = false;
  private eventBus: EventBus;
  private audioRecorder: import('./audio-recorder.js').AudioRecorder;
  private sttEngine: import('./stt-engine.js').STTEngine;
  private wakeWordDetector: import('./wake-word-detector.js').WakeWordDetector;
  private listenTimer: NodeJS.Timeout | null = null;

  constructor(eventBus: EventBus, deps: VoicePipelineDeps = {}) {
    this.eventBus = eventBus;
    this.audioRecorder = deps.audioRecorder ?? new SystemAudioRecorder();
    this.sttEngine = deps.sttEngine ?? new WhisperCliEngine();
    this.wakeWordDetector = deps.wakeWordDetector ?? new EnergyBasedWakeWordDetector();
  }

  async start(): Promise<void> {
    if (this.silent || this.isRunning) return;
    this.isRunning = true;
    this.listening = true;
    console.log('[Voice] Pipeline started — wake word detection active');

    if (this.microphoneAvailable()) {
      console.log('[Voice] Microphone detected and ready');
      // 启动常驻监听循环：短片段录音 → 唤醒词检测 → 录音 5s → STT → 事件
      this.scheduleListen();
    } else {
      console.log('[Voice] No microphone detected — text input only, listen loop disabled');
      // 不启动监听循环，避免持续报错
    }

    if (!this.sttEngine.available()) {
      console.log('[Voice] STT engine not available — text input only');
    }
  }

  /** 调度下一次监听循环 */
  private scheduleListen(): void {
    if (!this.isRunning) return;

    this.listenTimer = setTimeout(async () => {
      if (!this.isRunning) return;

      try {
        // 1. 录音短片段（1 秒）用于唤醒检测
        const shortAudioPath = this.audioRecorder.record(1000);

        // 2. 检测唤醒词
        const detected = await this.wakeWordDetector.detect(shortAudioPath);

        if (detected) {
          console.log('[Voice] Wake word detected, recording command...');

          // 3. 录音 5 秒
          const commandAudioPath = this.audioRecorder.record(5000);

          // 4. STT 转写
          const text = await this.sttEngine.transcribe(commandAudioPath);

          // 5. 发出 VoiceTranscribed 事件
          this.eventBus.emit({ kind: 'voice:transcribed', text });
          console.log(`[Voice] Transcribed: "${text}"`);
        }
      } catch (err) {
        if (this.isRunning) {
          console.error('[Voice] Listen loop error:', err);
          // 录音失败时延长重试间隔，避免持续报错占用 CPU
          setTimeout(() => this.scheduleListen(), 5000);
          return;
        }
      }

      // 正常路径继续下一次监听（100ms 间隔，避免 CPU 占用过高）
      if (this.isRunning) {
        this.scheduleListen();
      }
    }, 100);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.listening = false;
    if (this.listenTimer) {
      clearTimeout(this.listenTimer);
      this.listenTimer = null;
    }
    console.log('[Voice] Pipeline stopped');
  }

  async speak(text: string): Promise<void> {
    const os = platform();
    try {
      if (os === 'darwin') {
        execSync(`say "${text.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
      } else if (os === 'linux') {
        execSync(`echo "${text}" | espeak 2>/dev/null || echo "(TTS not available)"`, { stdio: 'pipe' });
      } else if (os === 'win32') {
        // Windows TTS via PowerShell
        execSync(`powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text.replace(/'/g, "''")}')"`, { stdio: 'pipe' });
      }
    } catch {
      console.log(`[Voice] TTS: "${text}"`);
    }
  }

  microphoneAvailable(): boolean {
    return this.audioRecorder.available();
  }

  setSilentMode(silent: boolean): void {
    this.silent = silent;
    if (silent && this.listening) {
      this.stop();
    } else if (!silent && !this.listening) {
      this.start();
    }
    this.eventBus.emit({ kind: 'voice:silent_mode_toggled', silent });
  }

  /** 手动触发一次录音 + 转写（供唤醒后调用或测试） */
  async recordAndTranscribe(durationMs = 5000): Promise<string> {
    if (!this.audioRecorder.available()) {
      throw new VoiceError(VoiceError.MICROPHONE_NOT_AVAILABLE, 'Microphone not available');
    }
    const audioPath = this.audioRecorder.record(durationMs);
    const text = await this.sttEngine.transcribe(audioPath);
    this.eventBus.emit({ kind: 'voice:transcribed', text });
    return text;
  }

  /** 手动触发唤醒词检测（供测试） */
  async checkWakeWord(audioPath: string): Promise<boolean> {
    return this.wakeWordDetector.detect(audioPath);
  }
}

// 保持向后兼容的别名
export { SystemVoicePipeline as StubVoicePipeline };
