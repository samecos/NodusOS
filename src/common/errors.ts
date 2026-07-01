// ============================================================
// Nodus 统一错误类型
// 所有模块抛出的错误应使用对应子类，便于上层统一捕获与降级。
// ============================================================

export class NodusError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** 代码智能模块错误 */
export class CodeIntelError extends NodusError {
  static readonly UNSUPPORTED_FILE = 'CI_UNSUPPORTED_FILE';
  static readonly NO_PARSER = 'CI_NO_PARSER';
  static readonly PARSE_FAILED = 'CI_PARSE_FAILED';
  static readonly NOT_INDEXED = 'CI_NOT_INDEXED';

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
  }
}

/** 环境管理模块错误 */
export class EnvError extends NodusError {
  static readonly UNKNOWN_PROJECT_TYPE = 'ENV_UNKNOWN_PROJECT_TYPE';
  static readonly RUNTIME_INSTALL_FAILED = 'ENV_RUNTIME_INSTALL_FAILED';
  static readonly DEP_INSTALL_FAILED = 'ENV_DEP_INSTALL_FAILED';
  static readonly COMMAND_FAILED = 'ENV_COMMAND_FAILED';
  static readonly RUNTIME_NOT_FOUND = 'ENV_RUNTIME_NOT_FOUND';

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
  }
}

/** Git 智能模块错误 */
export class GitError extends NodusError {
  static readonly NOT_A_REPO = 'GIT_NOT_A_REPO';
  static readonly COMMAND_FAILED = 'GIT_COMMAND_FAILED';
  static readonly PARSE_FAILED = 'GIT_PARSE_FAILED';

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
  }
}

/** 语音管道模块错误 */
export class VoiceError extends NodusError {
  static readonly MICROPHONE_NOT_AVAILABLE = 'VOICE_MICROPHONE_NOT_AVAILABLE';
  static readonly AUDIO_FILE_NOT_FOUND = 'VOICE_AUDIO_FILE_NOT_FOUND';
  static readonly TRANSCRIPTION_FAILED = 'VOICE_TRANSCRIPTION_FAILED';
  static readonly RECORDING_NOT_SUPPORTED = 'VOICE_RECORDING_NOT_SUPPORTED';
  static readonly RECORDING_FAILED = 'VOICE_RECORDING_FAILED';
  static readonly RECORDING_NO_OUTPUT = 'VOICE_RECORDING_NO_OUTPUT';

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
  }
}
