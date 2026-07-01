// ============================================================
// STTEngine — 语音转文字引擎接口
// ============================================================

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    try {
      // 使用 whisper CLI 输出到 stdout，模型默认 base
      const output = execSync(
        `${this.whisperPath} "${audioPath}" --model base --output_format txt --fp16 False`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 60_000 },
      );
      return output.trim();
    } catch (err) {
      throw new Error(`Transcription failed: ${err}`);
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
