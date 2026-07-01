// ============================================================
// 统一错误类型单元测试 — TC-UT-ERR-001 ~ TC-UT-ERR-004
// ============================================================

import { describe, it, expect } from 'vitest';
import { NodusError, CodeIntelError, EnvError, GitError, VoiceError } from './errors.js';

describe('NodusError', () => {
  // TC-UT-ERR-001: 统一错误基类应携带 code 与 cause
  it('TC-UT-ERR-001: should carry code, message and cause', () => {
    const cause = new Error('root cause');
    const err = new NodusError('TEST_CODE', 'something went wrong', { cause });

    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('something went wrong');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('NodusError');
  });

  // TC-UT-ERR-002: CodeIntelError 应可识别
  it('TC-UT-ERR-002: should create identifiable CodeIntelError', () => {
    const err = new CodeIntelError(CodeIntelError.UNSUPPORTED_FILE, 'Unsupported file: test.xyz');

    expect(err).toBeInstanceOf(CodeIntelError);
    expect(err).toBeInstanceOf(NodusError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(CodeIntelError.UNSUPPORTED_FILE);
  });

  // TC-UT-ERR-003: EnvError / GitError / VoiceError 应可识别
  it('TC-UT-ERR-003: should create identifiable module errors', () => {
    const envErr = new EnvError(EnvError.UNKNOWN_PROJECT_TYPE, 'Unknown project');
    const gitErr = new GitError(GitError.NOT_A_REPO, 'Not a git repo');
    const voiceErr = new VoiceError(VoiceError.MICROPHONE_NOT_AVAILABLE, 'No mic');

    expect(envErr).toBeInstanceOf(EnvError);
    expect(envErr.code).toBe(EnvError.UNKNOWN_PROJECT_TYPE);

    expect(gitErr).toBeInstanceOf(GitError);
    expect(gitErr.code).toBe(GitError.NOT_A_REPO);

    expect(voiceErr).toBeInstanceOf(VoiceError);
    expect(voiceErr.code).toBe(VoiceError.MICROPHONE_NOT_AVAILABLE);
  });

  // TC-UT-ERR-004: 模块错误应保留 cause
  it('TC-UT-ERR-004: should preserve cause in module errors', () => {
    const cause = new Error('underlying failure');
    const err = new EnvError(EnvError.COMMAND_FAILED, 'Command failed', { cause });

    expect(err.cause).toBe(cause);
  });
});
