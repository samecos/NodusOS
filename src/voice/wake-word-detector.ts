// ============================================================
// WakeWordDetector — 唤醒词检测
// ============================================================

export interface WakeWordDetector {
  /** 检测音频中是否包含唤醒词 */
  detect(audioPath: string): Promise<boolean>;
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

  setNextResult(detected: boolean): void {
    this.nextResult = detected;
  }

  async detect(_audioPath: string): Promise<boolean> {
    return this.nextResult;
  }
}
