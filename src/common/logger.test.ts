// ============================================================
// Logger 单元测试 — TC-UT-LOG-001 ~ TC-UT-LOG-004
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { FileLogger } from './logger.js';

describe('FileLogger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nodus-logger-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // TC-UT-LOG-001: 应创建日志目录与文件
  it('TC-UT-LOG-001: should create log directory and file', () => {
    const logger = new FileLogger({ logDir: tmpDir, console: false });
    logger.info('test', 'hello');

    const files = readFileSync(join(tmpDir, `nodus-${new Date().toISOString().slice(0, 10)}.log`), 'utf-8');
    expect(files).toContain('hello');
    expect(files).toContain('[INFO]');
    expect(files).toContain('[test]');
  });

  // TC-UT-LOG-002: 应写入不同级别日志
  it('TC-UT-LOG-002: should write different log levels', () => {
    const logger = new FileLogger({ logDir: tmpDir, console: false });
    logger.debug('test', 'debug msg');
    logger.info('test', 'info msg');
    logger.warn('test', 'warn msg');
    logger.error('test', 'error msg');

    const content = readFileSync(join(tmpDir, `nodus-${new Date().toISOString().slice(0, 10)}.log`), 'utf-8');
    expect(content).toContain('[INFO]');
    expect(content).toContain('[WARN]');
    expect(content).toContain('[ERROR]');
    expect(content).not.toContain('[DEBUG]'); // 默认 minLevel 为 info
  });

  // TC-UT-LOG-003: 应包含上下文 JSON
  it('TC-UT-LOG-003: should include context as JSON', () => {
    const logger = new FileLogger({ logDir: tmpDir, console: false });
    logger.info('test', 'with context', { user: 'alice', count: 42 });

    const content = readFileSync(join(tmpDir, `nodus-${new Date().toISOString().slice(0, 10)}.log`), 'utf-8');
    expect(content).toContain('"user":"alice"');
    expect(content).toContain('"count":42');
  });

  // TC-UT-LOG-004: minLevel 应过滤低级别日志
  it('TC-UT-LOG-004: should respect minLevel', () => {
    const logger = new FileLogger({ logDir: tmpDir, console: false, minLevel: 'warn' });
    logger.info('test', 'info msg');
    logger.warn('test', 'warn msg');

    const content = readFileSync(join(tmpDir, `nodus-${new Date().toISOString().slice(0, 10)}.log`), 'utf-8');
    expect(content).not.toContain('info msg');
    expect(content).toContain('warn msg');
  });
});
