// ============================================================
// NodusShell 集成测试
// ============================================================

import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { NodusShell } from './nodus-shell.js';
import { JsonConfigManager } from '../common/config.js';

const tinyProjectPath = join(import.meta.dirname!, '..', '..', 'tests', 'fixtures', 'tiny-project');
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('NodusShell', () => {
  let shell: NodusShell | undefined;

  afterEach(async () => {
    if (shell) {
      await shell.shutdown();
      shell = undefined;
    }
  });

  it('TC-UT-SH-001: should bootstrap and open project', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configManager = new JsonConfigManager(join(tmpDir, 'config.json'));
    configManager.set('projectPaths', [tinyProjectPath]);
    configManager.set('dbPath', ':memory:');
    shell = new NodusShell(configManager);

    await shell.bootstrap();

    // 查询应该返回结果
    const result = await shell.handleQuery('refundOrder在哪里定义的');
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');

    configManager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-UT-SH-002: should handle multiple queries', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configManager = new JsonConfigManager(join(tmpDir, 'config.json'));
    configManager.set('projectPaths', [tinyProjectPath]);
    configManager.set('dbPath', ':memory:');
    shell = new NodusShell(configManager);
    await shell.bootstrap();

    const r1 = await shell.handleQuery('refundOrder在哪里');
    expect(r1).toBeDefined();

    const r2 = await shell.handleQuery('PaymentService里有哪些');
    expect(r2).toBeDefined();

    configManager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-UT-SH-003: should handle unparseable queries gracefully', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configManager = new JsonConfigManager(join(tmpDir, 'config.json'));
    configManager.set('projectPaths', [tinyProjectPath]);
    configManager.set('dbPath', ':memory:');
    shell = new NodusShell(configManager);
    await shell.bootstrap();

    const result = await shell.handleQuery('');
    expect(result).toHaveProperty('kind');

    configManager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-UT-SH-004: should register and retrieve modules', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configManager = new JsonConfigManager(join(tmpDir, 'config.json'));
    configManager.set('projectPaths', [tinyProjectPath]);
    configManager.set('dbPath', ':memory:');
    shell = new NodusShell(configManager);
    await shell.bootstrap();

    // 内置模块可获取
    expect(shell.getModule('store')).toBeDefined();
    expect(shell.getModule('code_intelligence')).toBeDefined();
    expect(shell.getModule('nonexistent')).toBeUndefined();

    // 动态注册新模块
    const fakeModule = { name: 'test' };
    shell.registerModule('custom', fakeModule);
    expect(shell.getModule('custom')).toBe(fakeModule);

    configManager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TC-UT-SH-005: should shutdown cleanly', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configManager = new JsonConfigManager(join(tmpDir, 'config.json'));
    configManager.set('projectPaths', [tinyProjectPath]);
    configManager.set('dbPath', ':memory:');
    shell = new NodusShell(configManager);
    await shell.bootstrap();
    await shell.shutdown();
    // 不抛异常
    expect(true).toBe(true);

    configManager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // TC-UT-SH-007: 配置热加载后 locale 应即时生效
  it('TC-UT-SH-007: should use updated locale after config hot reload', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      locale: 'zh-CN',
      dbPath: ':memory:',
    }, null, 2));

    const configManager = new JsonConfigManager(configPath);

    try {
      shell = new NodusShell(configManager);
      await shell.bootstrap();

      // configManager 已在构造函数中自动注册
      expect(shell.getModule('config_manager')).toBe(configManager);

      writeFileSync(configPath, JSON.stringify({
        projectPaths: [tinyProjectPath],
        locale: 'en-US',
      }, null, 2));
      await wait(300);

      // locale 变更后，configManager 与 shell 均应反映新配置
      const updatedLocale = shell.getModule<JsonConfigManager>('config_manager')?.get().locale;
      expect(updatedLocale).toBe('en-US');

      const result = await shell.handleQueryFormatted('hello');
      expect(result).toBeDefined();
    } finally {
      configManager.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
