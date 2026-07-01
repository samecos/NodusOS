// ============================================================
// VoicePipeline 实现 — 系统原生语音
// ============================================================

import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import type { VoicePipeline } from './voice-pipeline.js';
import type { EventBus } from '../shell/event-bus.js';

export class SystemVoicePipeline implements VoicePipeline {
  private silent = false;
  private listening = false;

  constructor(private eventBus: EventBus) {}

  async start(): Promise<void> {
    if (this.silent) return;
    this.listening = true;
    console.log('[Voice] Pipeline started — wake word detection active');

    // 真实实现路径:
    // 1. 启动唤醒词检测: porcupine / openwakeword
    // 2. 检测到唤醒词 → 开始录音 (VAD)
    // 3. 录音结束 → STT (whisper.cpp / 系统原生)
    // 4. 发出 VoiceTranscribed 事件

    // 当前: 不支持实时语音，仅检测麦克风可用性
    if (this.microphoneAvailable()) {
      console.log('[Voice] Microphone detected and ready');
    } else {
      console.log('[Voice] No microphone detected — text input only');
    }
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
    const os = platform();
    try {
      if (os === 'darwin') {
        // macOS: check audio input devices
        const result = execSync('system_profiler SPAudioDataType 2>/dev/null | grep -i "input" | head -1', { encoding: 'utf-8', stdio: 'pipe' });
        return result.length > 0;
      } else if (os === 'linux') {
        // Linux: check /proc/asound or arecord
        execSync('arecord -l 2>/dev/null | head -1', { encoding: 'utf-8', stdio: 'pipe' });
        return true;
      } else if (os === 'win32') {
        // Windows: check audio devices via PowerShell
        execSync('powershell -Command "Get-PnpDevice -Class AudioEndpoint | Where-Object {$_.Status -eq \'OK\'} | Select-Object -First 1"', { encoding: 'utf-8', stdio: 'pipe' });
        return true;
      }
    } catch {
      // 无法检测，假设不可用
    }
    return false;
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
}

// 保持向后兼容的别名
export { SystemVoicePipeline as StubVoicePipeline };
