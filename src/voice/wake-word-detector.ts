// ============================================================
// WakeWordDetector — 唤醒词检测
// ============================================================

import { readFileSync } from 'node:fs';

export interface WakeWordDetector {
  /** 检测音频中是否包含唤醒词 */
  detect(audioPath: string): Promise<boolean>;
}

/** 解析 WAV 文件并计算 PCM 数据的 RMS 能量 */
function calculateWavEnergy(wavPath: string): number {
  try {
    const buffer = readFileSync(wavPath);

    // 检查 RIFF header（至少 44 字节）
    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
      return 0;
    }

    // 遍历 chunk 查找 fmt 和 data
    let offset = 12;
    let format = 0;
    let bitsPerSample = 0;
    let dataOffset = 0;
    let dataSize = 0;

    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === 'fmt ') {
        format = buffer.readUInt16LE(offset + 8);
        bitsPerSample = buffer.readUInt16LE(offset + 22);
      } else if (chunkId === 'data') {
        dataOffset = offset + 8;
        dataSize = chunkSize;
        break;
      }

      offset += 8 + chunkSize;
      // 如果 chunkSize 为奇数，需要 padding 对齐
      if (chunkSize % 2 === 1) offset++;
    }

    // 只支持 PCM 格式 (format === 1) 且找到 data chunk
    if (format !== 1 || dataOffset === 0 || dataSize === 0) {
      return 0;
    }

    // 目前只支持 16-bit PCM（SystemAudioRecorder 生成的格式）
    if (bitsPerSample !== 16) {
      return 0;
    }

    const pcmData = buffer.slice(dataOffset, Math.min(dataOffset + dataSize, buffer.length));
    const sampleCount = Math.floor(pcmData.length / 2);
    if (sampleCount === 0) return 0;

    let sum = 0;
    for (let i = 0; i < pcmData.length; i += 2) {
      const sample = pcmData.readInt16LE(i);
      const normalized = sample / 32768.0;
      sum += normalized * normalized;
    }

    return Math.sqrt(sum / sampleCount);
  } catch {
    return 0;
  }
}

/** 基于音频能量阈值的简单唤醒词检测器（无需外部依赖）
 *  通过计算 WAV 文件的 RMS 能量，判断是否超过阈值来模拟唤醒检测。
 *  适合 MVP 阶段作为 Porcupine 的零依赖替代品。
 */
export class EnergyBasedWakeWordDetector implements WakeWordDetector {
  private threshold: number;

  constructor(threshold = 0.01) {
    this.threshold = threshold;
  }

  async detect(audioPath: string): Promise<boolean> {
    const energy = calculateWavEnergy(audioPath);
    return energy > this.threshold;
  }
}

/** 基于本地 porcupine / openwakeword 的检测器（占位） */
export class PorcupineWakeWordDetector implements WakeWordDetector {
  async detect(_audioPath: string): Promise<boolean> {
    // MVP 阶段：尚未集成真正的唤醒词引擎。
    // 真实实现需引入 @picovoice/porcupine-node 或 openwakeword。
    return false;
  }
}

/** 用于测试的 Mock 唤醒词检测器 */
export class MockWakeWordDetector implements WakeWordDetector {
  private nextResult = false;
  private detectCount = 0;
  private onceResult: boolean | null = null;

  setNextResult(detected: boolean): void {
    this.nextResult = detected;
    this.onceResult = null;
  }

  /** 仅下一次 detect 返回指定值，之后恢复 false */
  setNextResultOnce(detected: boolean): void {
    this.onceResult = detected;
    this.nextResult = false;
  }

  getDetectCount(): number {
    return this.detectCount;
  }

  async detect(_audioPath: string): Promise<boolean> {
    this.detectCount++;
    if (this.onceResult !== null) {
      const result = this.onceResult;
      this.onceResult = null;
      return result;
    }
    return this.nextResult;
  }
}
