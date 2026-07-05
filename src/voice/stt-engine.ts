// ============================================================
// STTEngine — 语音转文字引擎接口
// ============================================================

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { VoiceError } from '../common/errors.js';

export interface STTEngine {
  /** 是否可用 */
  available(): boolean;
  /** 将音频文件转写为文本 */
  transcribe(audioPath: string): Promise<string>;
}

/** 基于外部 whisper CLI 的本地 STT 引擎 */
export class WhisperCliEngine implements STTEngine {
  private whisperPath: string;

  constructor(whisperPath = 'whisper') {
    this.whisperPath = whisperPath;
  }

  available(): boolean {
    try {
      execSync(`${this.whisperPath} --help`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  async transcribe(audioPath: string): Promise<string> {
    if (!existsSync(audioPath)) {
      throw new VoiceError(VoiceError.AUDIO_FILE_NOT_FOUND, `Audio file not found: ${audioPath}`);
    }

    try {
      // 使用 whisper CLI 输出到 stdout，模型默认 base
      const output = execSync(
        `${this.whisperPath} "${audioPath}" --model base --output_format txt --fp16 False`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 60_000 },
      );
      return output.trim();
    } catch (err) {
      throw new VoiceError(VoiceError.TRANSCRIPTION_FAILED, `Transcription failed: ${err}`, { cause: err });
    }
  }
}

/** 系统级 STT 回退引擎
 * 尝试使用平台原生语音能力作为外部 whisper 的降级方案：
 * - macOS: 尝试系统 Dictation 能力（通过 JXA 调用 Speech framework，失败则回退 whisper）
 * - Windows: 使用 Windows Speech API (System.Speech.Recognition)
 * - Linux: 使用 pocketsphinx / speech-dispatcher 回退
 */
export class SystemSTTEngine implements STTEngine {
  available(): boolean {
    const os = platform();
    if (os === 'win32') {
      return this.windowsSpeechAvailable();
    }
    if (os === 'darwin') {
      return this.macOSDictationAvailable();
    }
    if (os === 'linux') {
      return this.linuxSpeechAvailable();
    }
    return false;
  }

  private windowsSpeechAvailable(): boolean {
    try {
      execSync(
        'powershell -Command "Add-Type -AssemblyName System.Speech; $null"',
        { stdio: 'pipe' },
      );
      return true;
    } catch {
      return false;
    }
  }

  private macOSDictationAvailable(): boolean {
    try {
      // 检查 JXA 是否可用（Foundation 是 macOS 系统框架）
      execSync(
        'osascript -l JavaScript -e \'ObjC.import("Foundation");\'',
        { stdio: 'pipe' },
      );
      return true;
    } catch {
      // 回退：检查 whisper 是否可用
      try {
        execSync('whisper --help', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }
  }

  private linuxSpeechAvailable(): boolean {
    try {
      execSync('which pocketsphinx_continuous', { stdio: 'pipe' });
      return true;
    } catch {
      try {
        execSync('whisper --help', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }
  }

  async transcribe(audioPath: string): Promise<string> {
    if (!existsSync(audioPath)) {
      throw new VoiceError(VoiceError.AUDIO_FILE_NOT_FOUND, `Audio file not found: ${audioPath}`);
    }

    const os = platform();
    if (os === 'win32') {
      return this.transcribeWindows(audioPath);
    }
    if (os === 'darwin') {
      return this.transcribeMacOS(audioPath);
    }
    if (os === 'linux') {
      return this.transcribeLinux(audioPath);
    }
    throw new VoiceError(VoiceError.TRANSCRIPTION_FAILED, 'STT not supported on this platform');
  }

  private transcribeWindows(audioPath: string): string {
    const safePath = audioPath.replace(/'/g, "''");
    const psScript = `Add-Type -AssemblyName System.Speech; $sre = New-Object System.Speech.Recognition.SpeechRecognitionEngine; $sre.SetInputToWaveFile('${safePath}'); $result = $sre.Recognize(); if ($result) { $result.Text } else { '' }`;
    try {
      const output = execSync(
        `powershell -Command "${psScript}"`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 60_000 },
      );
      return output.trim();
    } catch (err) {
      throw new VoiceError(VoiceError.TRANSCRIPTION_FAILED, `Windows STT failed: ${err}`, { cause: err });
    }
  }

  private transcribeMacOS(audioPath: string): string {
    // 尝试 JXA 调用 Speech framework（SFSpeechRecognizer）
    const jxaScript = `
      ObjC.import('Speech');
      ObjC.import('Foundation');
      var recognizer = $.SFSpeechRecognizer.alloc.initWithLocaleIdentifier('zh-CN');
      var url = $.NSURL.fileURLWithPath('${audioPath.replace(/'/g, "\\'")}');
      var request = $.SFSpeechURLRecognitionRequest.alloc.initWithURL(url);
      var resultText = '';
      var done = false;
      recognizer.recognitionTaskWithRequestResultHandler(request, function(result, error) {
        if (result && result.isFinal) {
          resultText = result.bestTranscription.formattedString.js;
        }
        done = true;
      });
      for (var i = 0; i < 100 && !done; i++) {
        $.NSThread.sleepForTimeInterval(0.1);
      }
      resultText;
    `.trim();
    try {
      const output = execSync(
        `osascript -l JavaScript -e '${jxaScript.replace(/'/g, "'\\''")}'`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 30_000 },
      );
      const text = output.trim();
      if (text) return text;
    } catch {
      // JXA 失败，回退到 whisper
    }
    // 回退到 whisper CLI
    try {
      const output = execSync(
        `whisper "${audioPath}" --model base --output_format txt --fp16 False`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 60_000 },
      );
      return output.trim();
    } catch (err) {
      throw new VoiceError(VoiceError.TRANSCRIPTION_FAILED, `macOS STT failed: ${err}`, { cause: err });
    }
  }

  private transcribeLinux(audioPath: string): string {
    // 尝试 pocketsphinx
    try {
      const output = execSync(
        `pocketsphinx_continuous -infile "${audioPath.replace(/"/g, '\\"')}" 2>/dev/null`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 60_000 },
      );
      return output.trim();
    } catch {
      // 回退到 whisper
      try {
        const output = execSync(
          `whisper "${audioPath}" --model base --output_format txt --fp16 False`,
          { stdio: 'pipe', encoding: 'utf-8', timeout: 60_000 },
        );
        return output.trim();
      } catch (err) {
        throw new VoiceError(VoiceError.TRANSCRIPTION_FAILED, `Linux STT failed: ${err}`, { cause: err });
      }
    }
  }
}

/** 用于测试或降级场景的 Mock STT 引擎 */
export class MockSTTEngine implements STTEngine {
  private nextResult: string | null = null;

  available(): boolean {
    return true;
  }

  setNextResult(text: string): void {
    this.nextResult = text;
  }

  async transcribe(_audioPath: string): Promise<string> {
    const result = this.nextResult ?? '';
    this.nextResult = null;
    return result;
  }
}
