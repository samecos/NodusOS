// ============================================================
// NodusShell 集成测试
// ============================================================

import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { NodusShell } from './nodus-shell.js';
import { JsonConfigManager } from '../common/config.js';
import { CodeIntelError } from '../common/errors.js';

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

  // TC-UT-SH-009: 查询异常时应返回降级卡片
  it('TC-UT-SH-009: should return degradation card when query fails', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configPath = join(currentTmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      dbPath: ':memory:',
      locale: 'zh-CN',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    // 临时替换 codeIntel.query 为抛出 CodeIntelError 的 mock
    const originalQuery = shell.codeIntel.query.bind(shell.codeIntel);
    shell.codeIntel.query = async () => {
      throw new CodeIntelError(CodeIntelError.NOT_INDEXED, 'project not indexed');
    };

    try {
      const result = await shell.handleQueryFormatted('refundOrder在哪里定义的');
      expect(result).toContain(CodeIntelError.NOT_INDEXED);
      expect(result).toContain('shell');
    } finally {
      shell.codeIntel.query = originalQuery;
    }
  });

  // TC-UT-SH-010: openProject 失败时应降级并继续运行
  it('TC-UT-SH-010: should degrade when openProject fails', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const emptyProject = mkdtempSync(join(currentTmpDir, 'empty-project-'));
    const configPath = join(currentTmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [emptyProject],
      dbPath: ':memory:',
      locale: 'zh-CN',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);

    const errors: Array<{ module: string; code: string }> = [];
    shell.eventBus.on('error', (event) => {
      errors.push({ module: event.module, code: event.error.code });
    });

    await shell.bootstrap();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.code === 'ENV_UNKNOWN_PROJECT_TYPE')).toBe(true);
    expect(shell.getModule('code_intelligence')).toBeDefined();
  });

  // TC-UT-SH-011: 查询缓存命中
  it('TC-UT-SH-011: should return cached result on repeated query', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configPath = join(currentTmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      dbPath: ':memory:',
      locale: 'zh-CN',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const queryText = 'refundOrder在哪里定义的';
    const result1 = await shell.handleQueryFormatted(queryText);
    expect(result1).toBeDefined();

    // 第二次查询应命中缓存，标记 [cached]
    const result2 = await shell.handleQueryFormatted(queryText);
    expect(result2).toContain('[cached]');
  });

  // TC-UT-SH-012: getRecommendations 应返回推荐
  it('TC-UT-SH-012: should return recommendations', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configPath = join(currentTmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      dbPath: ':memory:',
      locale: 'zh-CN',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    // 设置 cursor_symbol 以触发上下文推荐
    shell.contextMgr.update({ kind: 'cursor_moved', file: 'test.ts', line: 1, col: 1, symbol: 'refundOrder' });

    const recs = shell.getRecommendationList();
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some(r => r.text.includes('refundOrder'))).toBe(true);

    const rendered = shell.getRecommendations();
    expect(rendered).toContain('你可能想问');
  });

  // TC-UT-SH-013: 呼吸灯状态切换
  it('TC-UT-SH-013: should emit ui:state_changed events during query', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configPath = join(currentTmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      dbPath: ':memory:',
      locale: 'zh-CN',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const states: string[] = [];
    shell.eventBus.on('ui:state_changed', (event) => {
      states.push(event.state);
    });

    await shell.handleQueryFormatted('refundOrder在哪里定义的');

    // 应至少包含 thinking → idle 的切换
    expect(states).toContain('thinking');
    expect(states).toContain('idle');
  });

  // TC-UT-SH-014: switchProject 应保存当前会话状态并切换项目
  it('TC-UT-SH-014: switchProject should save session state and switch to new project', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const tmpDir = currentTmpDir;
    const secondProject = mkdtempSync(join(tmpDir, 'second-project-'));
    writeFileSync(join(secondProject, 'package.json'), JSON.stringify({ name: 'second-project' }));
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      dbPath: ':memory:',
      locale: 'zh-CN',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    // 设置当前项目的会话状态
    shell.contextMgr.update({ kind: 'project_changed', root: tinyProjectPath });
    shell.contextMgr.update({ kind: 'file_opened', path: join(tinyProjectPath, 'index.ts') });
    shell.contextMgr.update({
      kind: 'cursor_moved',
      file: join(tinyProjectPath, 'index.ts'),
      line: 5,
      col: 2,
      symbol: 'refundOrder',
    });

    // 切换到新项目
    await shell.switchProject(secondProject);

    // 验证配置中已包含新项目
    const paths = currentConfigManager.get('projectPaths') as string[];
    expect(paths).toContain(secondProject);

    // 验证上下文已更新为新项目
    const ctx = shell.contextMgr.snapshot();
    expect(ctx.active_project_root).toBe(secondProject);
  });

  // TC-UT-SH-015: listProjects 应返回项目列表
  it('TC-UT-SH-015: listProjects should return list of projects', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configPath = join(currentTmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      dbPath: ':memory:',
      locale: 'zh-CN',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const projects = shell.listProjects();
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.some(p => p.path === tinyProjectPath)).toBe(true);
  });

  // TC-UT-SH-016: handleQuery 应检测 switch_project 意图并切换项目
  it('TC-UT-SH-016: handleQuery should detect switch_project intent and switch project', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const tmpDir = currentTmpDir;
    const secondProject = mkdtempSync(join(tmpDir, 'switch-target-'));
    writeFileSync(join(secondProject, 'package.json'), JSON.stringify({ name: 'switch-target' }));
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      dbPath: ':memory:',
      locale: 'zh-CN',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const result = await shell.handleQuery(`切换到 ${secondProject}`);
    expect(result).toBeDefined();
    if (typeof result === 'object' && result !== null && 'kind' in result) {
      expect(result.kind).toBe('switch_project');
    }

    // 验证配置中已包含新项目
    const paths = currentConfigManager.get('projectPaths') as string[];
    expect(paths).toContain(secondProject);
  });

  // TC-UT-SH-017: handleQuery 应检测 list_projects 意图并返回列表
  it('TC-UT-SH-017: handleQuery should detect list_projects intent and return list', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const configPath = join(currentTmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      dbPath: ':memory:',
      locale: 'zh-CN',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const result = await shell.handleQuery('列出所有项目');
    expect(Array.isArray(result)).toBe(true);
    const projects = result as Array<{ path: string }>;
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.some(p => p.path === tinyProjectPath)).toBe(true);
  });

  // TC-UT-SH-018: handleQueryFormatted 应检测 switch_project 意图并返回格式化消息
  it('TC-UT-SH-018: handleQueryFormatted should detect switch_project intent and return formatted message', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    const tmpDir = currentTmpDir;
    const secondProject = mkdtempSync(join(tmpDir, 'formatted-target-'));
    writeFileSync(join(secondProject, 'package.json'), JSON.stringify({ name: 'formatted-target' }));
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      projectPaths: [tinyProjectPath],
      dbPath: ':memory:',
      locale: 'zh-CN',
    }, null, 2));

    currentConfigManager = new JsonConfigManager(configPath);
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const result = await shell.handleQueryFormatted(`切换到 ${secondProject}`);
    expect(result).toContain('已切换到项目');
    expect(result).toContain(secondProject);
  });

  // TC-UT-SH-019: getProjectList 应返回格式化项目列表
  it('TC-UT-SH-019: getProjectList should return formatted project list', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const output = shell.getProjectList();
    expect(output).toContain('已打开的项目');
    expect(output).toContain(tinyProjectPath);
    expect(output).toContain('●');
  });

  // TC-UT-SH-020: recordManualFeedback 不应抛出异常
  it('TC-UT-SH-020: recordManualFeedback should append feedback without error', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    process.env.HOME = currentTmpDir;
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    expect(() => shell!.recordManualFeedback('测试反馈')).not.toThrow();
  });

  // TC-UT-SH-021: exportSyncData 应返回同步数据包
  it('TC-UT-SH-021: exportSyncData should return sync data package', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const data = shell.exportSyncData();
    expect(data.version).toBe(1);
    expect(data.projects.length).toBeGreaterThan(0);
    expect(data.exportedAt).toBeDefined();
  });

  // TC-UT-SH-022: 代码生成意图应返回变更建议
  it('TC-UT-SH-022: should handle code_generation intent', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const result = await shell.handleQueryFormatted('给出代码改进建议');
    expect(result).toBeDefined();
    expect(result).toContain('代码生成建议');
  });

  // TC-UT-SH-023: 跨域调试意图应返回错误追踪结果
  it('TC-UT-SH-023: should handle cross_domain_debug intent', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const result = await shell.handleQueryFormatted('解析这个错误日志 TypeError: x at func (src/app.ts:42:10)');
    expect(result).toBeDefined();
    expect(result).toContain('错误追踪');
  });

  // TC-UT-SH-024: 团队协作导出意图应返回 JSON
  it('TC-UT-SH-024: should handle team_collab_share intent', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const result = await shell.handleQueryFormatted('导出项目索引');
    expect(result).toBeDefined();
    expect(result).toContain('项目索引');
  });

  // TC-UT-SH-025: view_annotated 应支持 basename 查找
  it('TC-UT-SH-025: should resolve view_annotated intent by basename', async () => {
    currentTmpDir = mkdtempSync(join(tmpdir(), 'nodus-shell-test-'));
    currentConfigManager = new JsonConfigManager(join(currentTmpDir, 'config.json'));
    currentConfigManager.set('projectPaths', [tinyProjectPath]);
    currentConfigManager.set('dbPath', ':memory:');
    shell = new NodusShell(currentConfigManager);
    await shell.bootstrap();

    const result = await shell.handleQueryFormatted('查看 index.ts');
    expect(result).toBeDefined();
    expect(result).not.toContain('无法读取文件');
  });
});
