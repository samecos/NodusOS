// ============================================================
// EnvironmentManager 单元测试
// TC-UT-EM-001 ~ TC-UT-EM-009
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EnvironmentManagerImpl } from './environment-manager.impl.js';

describe('EnvironmentManager', () => {
  let testDir: string;
  let em: EnvironmentManagerImpl;

  beforeEach(() => {
    testDir = join(tmpdir(), `nodus-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    em = new EnvironmentManagerImpl();
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  // TC-UT-EM-001: 识别 TypeScript 项目
  it('TC-UT-EM-001: should detect TypeScript project', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'myapp',
      dependencies: { typescript: '^5.0' },
      engines: { node: '>=18.0.0' },
    }));
    writeFileSync(join(testDir, 'tsconfig.json'), '{}');
    writeFileSync(join(testDir, 'package-lock.json'), '');

    const meta = await em.detectProject(testDir);
    expect(meta.name).toBe('myapp');
    expect(meta.languages).toContain('typescript');
    expect(meta.package_manager).toBe('npm');
  });

  // TC-UT-EM-002: 识别 Next.js 项目
  it('TC-UT-EM-002: should detect Next.js project', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'nextapp',
      dependencies: { next: '^14', typescript: '^5' },
    }));

    const meta = await em.detectProject(testDir);
    expect(meta.framework).toBe('nextjs');
  });

  // TC-UT-EM-003: 识别 Python pyproject.toml
  it('TC-UT-EM-003: should detect Python project with pyproject.toml', async () => {
    writeFileSync(join(testDir, 'pyproject.toml'), `
[project]
name = "myapp"
requires-python = ">=3.12"
`);

    const meta = await em.detectProject(testDir);
    expect(meta.languages).toContain('python');
    expect(meta.runtimes).toContainEqual({
      language: 'python', constraint: '>=3.12', specified_in: 'pyproject.toml',
    });
  });

  // TC-UT-EM-004: 识别 Python requirements.txt
  it('TC-UT-EM-004: should detect Python project with requirements.txt', async () => {
    writeFileSync(join(testDir, 'requirements.txt'), 'requests\nflask\n');

    const meta = await em.detectProject(testDir);
    expect(meta.languages).toContain('python');
    expect(meta.package_manager).toBe('pip');
  });

  // TC-UT-EM-005: 混合项目 (TS + Python)
  it('TC-UT-EM-005: should detect mixed project', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'mixed', dependencies: { typescript: '^5' } }));
    writeFileSync(join(testDir, 'tsconfig.json'), '{}');
    writeFileSync(join(testDir, 'pyproject.toml'), '[project]\nname = "mixed"\n');

    const meta = await em.detectProject(testDir);
    expect(meta.languages).toContain('typescript');
    expect(meta.languages).toContain('python');
  });

  // TC-UT-EM-007~009: 包管理器检测
  it('should detect pnpm', () => {
    writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
    expect(em.detectPackageManager(testDir)).toBe('pnpm');
  });

  it('should detect yarn', () => {
    writeFileSync(join(testDir, 'yarn.lock'), '');
    expect(em.detectPackageManager(testDir)).toBe('yarn');
  });

  it('should detect Poetry', () => {
    writeFileSync(join(testDir, 'pyproject.toml'), '[tool.poetry]\nname = "test"\n');
    expect(em.detectPackageManager(testDir)).toBe('poetry');
  });

  // TC-UT-EM-010: installRuntime 在已安装时直接返回
  it('TC-UT-EM-010: should skip install when runtime is already installed', async () => {
    // 当前环境通常已安装 Node，checkRuntime 会返回 installed
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await em.installRuntime('typescript', '>=1.0.0');
      // 不应打印安装提示
      const installMessages = spy.mock.calls.filter(
        ([msg]) => typeof msg === 'string' && msg.includes('required — please install'),
      );
      expect(installMessages.length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
