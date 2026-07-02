// ============================================================
// ConfigManager 单元测试 — TC-UT-CFG-001 ~ TC-UT-CFG-006
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { JsonConfigManager, DEFAULT_CONFIG } from './config.js';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('JsonConfigManager', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nodus-config-test-'));
    configPath = join(tmpDir, 'config.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // TC-UT-CFG-001: 无配置文件时应创建默认配置
  it('TC-UT-CFG-001: should create default config when file missing', () => {
    const manager = new JsonConfigManager(configPath);
    const config = manager.get();

    expect(config.voice.wakeWord).toBe(DEFAULT_CONFIG.voice.wakeWord);
    expect(config.ui.theme).toBe(DEFAULT_CONFIG.ui.theme);
    expect(config.env.autoInstallRuntime).toBe(DEFAULT_CONFIG.env.autoInstallRuntime);
    expect(config.codeIntel.excludePatterns).toEqual(DEFAULT_CONFIG.codeIntel.excludePatterns);

    // 应写入文件
    expect(readFileSync(configPath, 'utf-8')).toContain('wakeWord');
    manager.close();
  });

  // TC-UT-CFG-002: 应读取已有配置文件
  it('TC-UT-CFG-002: should load existing config file', () => {
    writeFileSync(configPath, JSON.stringify({
      locale: 'en-US',
      voice: { wakeWord: '结绳', silentMode: true },
    }, null, 2));

    const manager = new JsonConfigManager(configPath);
    expect(manager.get('voice.wakeWord')).toBe('结绳');
    expect(manager.get('voice.silentMode')).toBe(true);
    expect(manager.get('locale')).toBe('en-US');
    // 未指定字段使用默认值
    expect(manager.get('ui.theme')).toBe('system');
    manager.close();
  });

  // TC-UT-CFG-003: set 应修改并持久化配置
  it('TC-UT-CFG-003: should set and persist config value', () => {
    const manager = new JsonConfigManager(configPath);
    manager.set('voice.wakeWord', 'HeyNodus');

    expect(manager.get('voice.wakeWord')).toBe('HeyNodus');
    const raw = readFileSync(configPath, 'utf-8');
    expect(raw).toContain('HeyNodus');
    manager.close();
  });

  // TC-UT-CFG-004: set 嵌套路径时应自动创建中间对象
  it('TC-UT-CFG-004: should create nested objects on set', () => {
    const manager = new JsonConfigManager(configPath);
    manager.set('custom.foo.bar', 42);

    expect(manager.get('custom.foo.bar')).toBe(42);
    manager.close();
  });

  // TC-UT-CFG-005: reload 应重新加载磁盘配置
  it('TC-UT-CFG-005: should reload config from disk', () => {
    const manager = new JsonConfigManager(configPath);
    manager.set('voice.wakeWord', 'OldWord');

    // 模拟外部修改
    writeFileSync(configPath, JSON.stringify({ voice: { wakeWord: 'NewWord' } }, null, 2));

    manager.reload();
    expect(manager.get('voice.wakeWord')).toBe('NewWord');
    manager.close();
  });

  // TC-UT-CFG-006: onChange 应在配置变更时触发
  it('TC-UT-CFG-006: should notify change listeners', () => {
    const manager = new JsonConfigManager(configPath);
    const changes: string[] = [];
    const unsubscribe = manager.onChange((config) => {
      changes.push(config.voice.wakeWord);
    });

    manager.set('voice.wakeWord', 'One');
    manager.set('voice.wakeWord', 'Two');

    expect(changes).toEqual(['One', 'Two']);

    unsubscribe();
    manager.set('voice.wakeWord', 'Three');
    expect(changes).toEqual(['One', 'Two']);
    manager.close();
  });

  // TC-UT-CFG-007: 启动后创建配置文件应触发 hot reload
  it('TC-UT-CFG-007: should hot-reload when config file is created later', async () => {
    const manager = new JsonConfigManager(configPath);
    const changes: import('./config.js').NodusConfig[] = [];
    manager.onChange((cfg) => changes.push(cfg));

    // 模拟启动时配置文件不存在（constructor 会自动创建默认配置，需先移除）
    rmSync(configPath, { force: true });
    expect(existsSync(configPath)).toBe(false);

    writeFileSync(configPath, JSON.stringify({ locale: 'ja-JP' }, null, 2));
    await wait(250);

    expect(manager.get('locale')).toBe('ja-JP');
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[changes.length - 1]!.locale).toBe('ja-JP');
    manager.close();
  });
});
