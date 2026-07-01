// ============================================================
// VoicePipeline 实现 — 系统原生语音
// ============================================================

import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import type { VoicePipeline } from './voice-pipeline.js';
import type { EventBus } from '../shell/event-bus.js';
import { SystemAudioRecorder } from './audio-recorder.js';
import { WhisperCliEngine, MockSTTEngine } from './stt-engine.js';
import { PorcupineWakeWordDetector } from './wake-word-detector.js';

export interface VoicePipelineDeps {
  audioRecorder?: import('./audio-recorder.js').AudioRecorder;
  sttEngine?: import('./stt-engine.js').STTEngine;
  wakeWordDetector?: import('./wake-word-detector.js').WakeWordDetector;
}

export class SystemVoicePipeline implements VoicePipeline {
  private silent = false;
  private listening = false;
  private eventBus: EventBus;
  private audioRecorder: import('./audio-recorder.js').AudioRecorder;
  private sttEngine: import('./stt-engine.js').STTEngine;
  private wakeWordDetector: import('./wake-word-detector.js').WakeWordDetector;

  constructor(eventBus: EventBus, deps: VoicePipelineDeps = {}) {
    this.eventBus = eventBus;
    this.audioRecorder = deps.audioRecorder ?? new SystemAudioRecorder();
    this.sttEngine = deps.sttEngine ?? new WhisperCliEngine();
    this.wakeWordDetector = deps.wakeWordDetector ?? new PorcupineWakeWordDetector();
  }

  async start(): Promise<void> {
    if (this.silent) return;
    this.listening = true;
    console.log('[Voice] Pipeline started — wake word detection active');

    if (this.microphoneAvailable()) {
      console.log('[Voice] Microphone detected and ready');
    } else {
      console.log('[Voice] No microphone detected — text input only');
    }

    if (!this.sttEngine.available()) {
      console.log('[Voice] STT engine not available — text input only');
    }

    // 真实实现路径：
    // 1. 持续监听唤醒词
    // 2. 检测到唤醒词 → 录音 5 秒
    // 3. STT 转写 → 发出 VoiceTranscribed 事件
    // MVP 阶段暂不启动常驻后台监听线程，避免资源占用与外部依赖缺失导致的错误。
  }

  async stop(): Promise<void> {
    this.listening = false;
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
      throw new Error('Microphone not available');
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
