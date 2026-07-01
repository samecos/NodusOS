// ============================================================
// NodusShell 集成测试
// ============================================================

import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { NodusShell } from './nodus-shell.js';

const FIXTURE_DIR = join(import.meta.dirname!, '..', '..', 'tests', 'fixtures', 'tiny-project');

describe('NodusShell', () => {
  let shell: NodusShell;

  afterEach(async () => {
    if (shell) await shell.shutdown();
  });

  it('should bootstrap and open project', async () => {
    shell = new NodusShell({
      projectPaths: [FIXTURE_DIR],
      dbPath: ':memory:',
    });

    await shell.bootstrap();

    // 查询应该返回结果
    const result = await shell.handleQuery('refundOrder在哪里定义的');
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('should handle multiple queries', async () => {
    shell = new NodusShell({
      projectPaths: [FIXTURE_DIR],
      dbPath: ':memory:',
    });
    await shell.bootstrap();

    const r1 = await shell.handleQuery('refundOrder在哪里');
    expect(r1).toBeDefined();

    const r2 = await shell.handleQuery('PaymentService里有哪些');
    expect(r2).toBeDefined();
  });

  it('should handle unparseable queries gracefully', async () => {
    shell = new NodusShell({
      projectPaths: [FIXTURE_DIR],
      dbPath: ':memory:',
    });
    await shell.bootstrap();

    const result = await shell.handleQuery('');
    expect(result).toHaveProperty('kind');
  });

  it('should register and retrieve modules', async () => {
    shell = new NodusShell({
      projectPaths: [FIXTURE_DIR],
      dbPath: ':memory:',
    });
    await shell.bootstrap();

    // 内置模块可获取
    expect(shell.getModule('store')).toBeDefined();
    expect(shell.getModule('code_intelligence')).toBeDefined();
    expect(shell.getModule('nonexistent')).toBeUndefined();

    // 动态注册新模块
    const fakeModule = { name: 'test' };
    shell.registerModule('custom', fakeModule);
    expect(shell.getModule('custom')).toBe(fakeModule);
  });

  it('should shutdown cleanly', async () => {
    shell = new NodusShell({
      projectPaths: [FIXTURE_DIR],
      dbPath: ':memory:',
    });
    await shell.bootstrap();
    await shell.shutdown();
    // 不抛异常
    expect(true).toBe(true);
  });
});
