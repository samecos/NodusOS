// ============================================================
// AudioRecorder — 将麦克风输入录制为音频文件
// ============================================================

import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface AudioRecorder {
  /** 检测录音工具是否可用 */
  available(): boolean;
  /** 录制指定毫秒数的音频，返回 WAV 文件路径 */
  record(durationMs: number): string;
}

export class SystemAudioRecorder implements AudioRecorder {
  available(): boolean {
    return this.detectCommand() !== null;
  }

  record(durationMs: number): string {
    const cmd = this.detectCommand();
    if (!cmd) {
      throw new Error('No available audio recording command');
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'nodus-audio-'));
    const outputPath = join(tmpDir, 'recording.wav');
    const durationSec = Math.max(1, Math.round(durationMs / 1000));
    const os = platform();

    try {
      if (os === 'darwin') {
        // macOS: sox (brew install sox) 或 rec
        execSync(
          `sox -d -r 16000 -c 1 -b 16 "${outputPath}" trim 0 ${durationSec}`,
          { stdio: 'pipe', timeout: durationMs + 2000 },
        );
      } else if (os === 'linux') {
        // Linux: arecord (alsa-utils)
        execSync(
          `arecord -D default -f S16_LE -r 16000 -c 1 -d ${durationSec} "${outputPath}"`,
          { stdio: 'pipe', timeout: durationMs + 2000 },
        );
      } else {
        throw new Error(`Audio recording not supported on ${os}`);
      }
    } catch (err) {
      throw new Error(`Recording failed: ${err}`);
    }

    if (!existsSync(outputPath)) {
      throw new Error('Recording produced no output file');
    }

    return outputPath;
  }

  private detectCommand(): string | null {
    const os = platform();
    try {
      if (os === 'darwin') {
        execSync('sox --version', { stdio: 'pipe' });
        return 'sox';
      }
      if (os === 'linux') {
        execSync('arecord --version', { stdio: 'pipe' });
        return 'arecord';
      }
    } catch {
      // 不可用
    }
    return null;
  }
}
