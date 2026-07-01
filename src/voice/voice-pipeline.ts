// ============================================================
// VoicePipeline — 语音管线接口
// 与 ArchitecturalDesignPhase/04-API-Reference.md §8 一致
// ============================================================

export type VoiceError =
  | { kind: 'no_microphone' }
  | { kind: 'permission_denied' }
  | { kind: 'wake_word_timeout' }
  | { kind: 'transcription_failed'; reason: string }
  | { kind: 'synthesis_failed'; reason: string }
  | { kind: 'device_busy' };

export interface VoicePipeline {
  /** 启动语音管线（唤醒词监听→录音→转写自动完成） */
  start(): Promise<void>;

  /** 停止语音管线 */
  stop(): Promise<void>;

  /** TTS 并播放 */
  speak(text: string): Promise<void>;

  /** 麦克风是否可用 */
  microphoneAvailable(): boolean;

  /** 进入/退出无声模式 */
  setSilentMode(silent: boolean): void;
}
