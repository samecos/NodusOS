// ============================================================
// EnvironmentManager 单元测试
// TC-UT-EM-001 ~ TC-UT-EM-015
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

  // TC-UT-EM-011: 应选择合适的 pip 命令
  it('TC-UT-EM-011: should select available pip command', () => {
    const pipCmd = (em as unknown as { getPipCommand: () => string }).getPipCommand();
    expect(pipCmd).toMatch(/python3 -m pip|pip3|pip/);
  });

  // TC-UT-EM-012: 应复用已存在的 .venv
  it('TC-UT-EM-012: should reuse existing Python venv', () => {
    const venvDir = join(testDir, '.venv');
    mkdirSync(join(venvDir, 'bin'), { recursive: true });
    writeFileSync(join(venvDir, 'bin', 'python'), '');

    const venvPath = (em as unknown as { ensurePythonVenv: (path: string) => string }).ensurePythonVenv(testDir);
    expect(venvPath).toBe(venvDir);
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

  // ---- R3.5 外部服务检测 ----

  // TC-UT-EM-013: 从 .env 文件检测 PostgreSQL
  it('TC-UT-EM-013: should detect PostgreSQL from .env file', async () => {
    writeFileSync(join(testDir, '.env'), 'DATABASE_URL=postgresql://user:pass@localhost:5432/db\n');

    const services = await em.detectExternalServices(testDir);
    const pg = services.find(s => s.type === 'postgresql');
    expect(pg).toBeDefined();
    // 测试环境可能已有 PostgreSQL 运行，因此接受 config_found 或 running
    expect(['config_found', 'running']).toContain(pg!.status.kind);
    if (pg!.status.kind === 'config_found') {
      expect((pg!.status as { config_source?: string }).config_source).toBe('.env');
    }
  });

  // TC-UT-EM-014: 从 docker-compose.yml 检测 Redis + MySQL
  it('TC-UT-EM-014: should detect Redis and MySQL from docker-compose.yml', async () => {
    writeFileSync(join(testDir, 'docker-compose.yml'), `
version: "3.8"
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: root
    ports:
      - "3306:3306"
`);

    const services = await em.detectExternalServices(testDir);
    const redis = services.find(s => s.type === 'redis');
    const mysql = services.find(s => s.type === 'mysql');
    expect(redis).toBeDefined();
    expect(['config_found', 'running', 'missing']).toContain(redis!.status.kind);
    expect(mysql).toBeDefined();
    expect(['config_found', 'running', 'missing']).toContain(mysql!.status.kind);
  });

  // TC-UT-EM-015: 从 redis.conf 检测 Redis
  it('TC-UT-EM-015: should detect Redis from redis.conf', async () => {
    writeFileSync(join(testDir, 'redis.conf'), 'port 6379\nbind 127.0.0.1\n');

    const services = await em.detectExternalServices(testDir);
    const redis = services.find(s => s.type === 'redis');
    expect(redis).toBeDefined();
    expect(['config_found', 'running']).toContain(redis!.status.kind);
  });

  // TC-UT-EM-016: 从 package.json 依赖推断 MongoDB
  it('TC-UT-EM-016: should infer MongoDB from package.json dependency', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'mongo-app',
      dependencies: { mongodb: '^6.0' },
    }));

    const services = await em.detectExternalServices(testDir);
    const mongo = services.find(s => s.type === 'mongodb');
    expect(mongo).toBeDefined();
    expect(mongo!.status.kind).toBe('not_detected');
  });

  // TC-UT-EM-017: 合并重复服务优先级测试
  it('TC-UT-EM-017: should merge duplicate services with correct priority', async () => {
    writeFileSync(join(testDir, '.env'), 'DATABASE_URL=postgresql://localhost:5432/db\n');
    writeFileSync(join(testDir, 'docker-compose.yml'), `
services:
  postgres:
    image: postgres:15
    ports:
      - "5432:5432"
`);

    const services = await em.detectExternalServices(testDir);
    const pg = services.filter(s => s.type === 'postgresql');
    expect(pg.length).toBe(1);
    // config_found 优先级高于 not_detected；若环境已运行则为 running
    expect(['config_found', 'running']).toContain(pg[0].status.kind);
  });

  // TC-UT-EM-018: startService 返回正确启动建议
  it('TC-UT-EM-018: should return start command for docker', async () => {
    const cmd = await em.startService({ type: 'docker', status: { kind: 'missing', config_source: 'docker-compose.yml', hint: '' } });
    expect(cmd).toContain('docker compose up');
  });

  it('should return start command for redis', async () => {
    const cmd = await em.startService({ type: 'redis', status: { kind: 'missing', config_source: 'redis.conf', hint: '' } });
    expect(cmd).toContain('redis-server');
  });

  it('should return start command for postgresql', async () => {
    const cmd = await em.startService({ type: 'postgresql', status: { kind: 'missing', config_source: '.env', hint: '' } });
    expect(cmd).toContain('pg_ctl');
  });

  // TC-UT-EM-019: checkServiceStatus 返回 not_detected（端口无监听）
  it('TC-UT-EM-019: should return not_detected for unavailable service', async () => {
    const status = await em.checkServiceStatus('redis', 65535);
    expect(status.kind).toBe('not_detected');
  });
});
