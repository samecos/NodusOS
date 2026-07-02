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

// ============================================================
// 降级建议映射
// ============================================================

const DEGRADATION_SUGGESTIONS: Record<string, string> = {
  [CodeIntelError.UNSUPPORTED_FILE]: '该文件类型暂不支持解析，可尝试用文本查询其他文件。',
  [CodeIntelError.NO_PARSER]: '解析器未就绪，请确认 native 依赖已正确构建。',
  [CodeIntelError.PARSE_FAILED]: '文件解析失败，请检查语法或稍后重试。',
  [CodeIntelError.NOT_INDEXED]: '文件尚未索引，可等待索引完成后再查询。',
  [EnvError.UNKNOWN_PROJECT_TYPE]: '无法识别项目类型，请检查项目结构或手动指定运行时。',
  [EnvError.RUNTIME_INSTALL_FAILED]: '运行时安装失败，可尝试手动安装后重启。',
  [EnvError.DEP_INSTALL_FAILED]: '依赖安装失败，建议检查网络或包管理器日志。',
  [EnvError.COMMAND_FAILED]: '外部命令执行失败，请确认命令可用。',
  [EnvError.RUNTIME_NOT_FOUND]: '未找到指定运行时，请先安装对应版本。',
  [GitError.NOT_A_REPO]: '当前目录不是 git 仓库，无法提供变更历史。',
  [GitError.COMMAND_FAILED]: 'git 命令执行失败，请确认 git 已安装且仓库状态正常。',
  [VoiceError.MICROPHONE_NOT_AVAILABLE]: '麦克风不可用，已切换为文本输入模式。',
  [VoiceError.AUDIO_FILE_NOT_FOUND]: '音频文件不存在，请确认录音已完成。',
  [VoiceError.TRANSCRIPTION_FAILED]: '语音识别失败，请重试或切换为键盘输入。',
  [VoiceError.RECORDING_NOT_SUPPORTED]: '当前平台不支持录音，已切换为文本输入模式。',
  [VoiceError.RECORDING_FAILED]: '录音启动失败，请检查麦克风权限或切换为键盘输入。',
  [VoiceError.RECORDING_NO_OUTPUT]: '录音无输出，请确认麦克风可用或切换为键盘输入。',
};

/** 根据错误码获取降级建议 */
export function getDegradationSuggestion(code: string): string {
  return DEGRADATION_SUGGESTIONS[code] ?? '系统遇到意外问题，请稍后重试或查看日志。';
}
