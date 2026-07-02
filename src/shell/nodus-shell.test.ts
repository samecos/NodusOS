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
  let currentConfigManager: JsonConfigManager | undefined;
  let currentTmpDir: string | undefined;

  afterEach(async () => {
    if (shell) {
      await shell.shutdown();
      shell = undefined;
    }
    currentConfigManager?.close();
    currentConfigManager = undefined;
    if (currentTmpDir) {
      rmSync(currentTmpDir, { recursive: true, force: true });
      currentTmpDir = undefined;
    }
  });

  it('TC-UT-SH-001: should bootstrap and open project', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);

    await shell.bootstrap();

    // 查询应该返回结果
    const result = await shell.handleQuery('refundOrder在哪里定义的');
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('TC-UT-SH-002: should handle multiple queries', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const r1 = await shell.handleQuery('refundOrder在哪里');
    expect(r1).toBeDefined();

    const r2 = await shell.handleQuery('PaymentService里有哪些');
    expect(r2).toBeDefined();
  });

  it('TC-UT-SH-003: should handle unparseable queries gracefully', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const result = await shell.handleQuery('');
    expect(result).toHaveProperty('kind');
  });

  it('TC-UT-SH-004: should register and retrieve modules', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
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

  it('TC-UT-SH-005: should shutdown cleanly', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();
    await shell.shutdown();
    // 不抛异常
    expect(true).toBe(true);
  });

  // TC-UT-SH-007: 配置热加载后 locale 应即时生效，且 shell 应发出 config:changed 事件
  it('TC-UT-SH-007: should use updated locale after config hot reload', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configPath = join(currentTmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      locale: 'zh-CN',
      dbPath: ':memory:',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    // configManager 已在构造函数中自动注册
    expect(shell.getModule('config_manager')).toBe(currentConfigManager);

    const configChanges: string[] = [];
    shell.eventBus.on('config:changed', (event) => {
      configChanges.push(event.config.locale);
    });

    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      locale: 'en-US',
    }, null, 2));
    await wait(300);

    // locale 变更后，configManager 与 shell 均应反映新配置
    expect(currentConfigManager.get().locale).toBe('en-US');
    expect(configChanges).toContain('en-US');

    const result = await shell.handleQueryFormatted('hello');
    expect(result).toBeDefined();
  });

  // TC-UT-SH-008: 重启后应恢复项目、文件与光标位置
  it('TC-UT-SH-008: should restore session state after restart', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const tmpDir = currentTmpDir;
    const dbPath = join(tmpDir, 'session.db');
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      dbPath,
      locale: 'zh-CN',
    }, null, 2));

    // 第一次启动：建立会话状态
    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    shell.contextMgr.update({ kind: 'project_changed', root: tinyProjectPath });
    shell.contextMgr.update({ kind: 'file_opened', path: join(tinyProjectPath, 'index.ts') });
    shell.contextMgr.update({
      kind: 'cursor_moved',
      file: join(tinyProjectPath, 'index.ts'),
      line: 7,
      col: 3,
      symbol: 'greet',
    });

    await shell.shutdown();
    shell = undefined;
    currentConfigManager?.close();
    currentConfigManager = undefined;

    // 第二次启动：验证恢复
    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const ctx = shell.contextMgr.snapshot();
    expect(ctx.active_project_root).toBe(tinyProjectPath);
    expect(ctx.active_file).toBe(join(tinyProjectPath, 'index.ts'));
    expect(ctx.cursor_line).toBe(7);
    expect(ctx.cursor_col).toBe(3);
    expect(ctx.cursor_symbol).toBe('greet');
  });
});
