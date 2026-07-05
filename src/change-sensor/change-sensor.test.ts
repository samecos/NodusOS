import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { DefaultChangeSensor } from './change-sensor.impl.js';
import type { GitIntelligence } from '../git-intel/git-intelligence.js';
import { GitIntelligenceImpl } from '../git-intel/git-intelligence.impl.js';

describe('DefaultChangeSensor', () => {
  let projectRoot: string;
  let gitIntel: GitIntelligence;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'nodus-sensor-'));
    execSync('git init', { cwd: projectRoot, stdio: 'pipe' });
    execSync('git config user.email test@test.com && git config user.name test', { cwd: projectRoot, stdio: 'pipe' });
    writeFileSync(join(projectRoot, 'app.ts'), 'export function foo() { return 1; }\n');
    execSync('git add -A && git commit -m init', { cwd: projectRoot, stdio: 'pipe' });
    gitIntel = new GitIntelligenceImpl();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // TC-UT-CS-001: detect 应返回含改动的 ChangeBatch
  it('TC-UT-CS-001: detect should return ChangeBatch with changed files', async () => {
    // 模拟 AI 改文件
    writeFileSync(join(projectRoot, 'app.ts'), 'export function foo() { return 2; }\nexport function bar() { return 3; }\n');
    writeFileSync(join(projectRoot, 'util.ts'), 'export function util() { return 0; }\n');

    const sensor = new DefaultChangeSensor(gitIntel);
    const batch = await sensor.detect(projectRoot);

    expect(batch).not.toBeNull();
    expect(batch!.files).toContain('app.ts');
    expect(batch!.files).toContain('util.ts');
    expect(batch!.detected_at).toBeDefined();
    expect(batch!.id).toBeDefined();
  });

  // TC-UT-CS-002: 无变更时返回 null
  it('TC-UT-CS-002: detect should return null when no changes', async () => {
    const sensor = new DefaultChangeSensor(gitIntel);
    const batch = await sensor.detect(projectRoot);
    expect(batch).toBeNull();
  });

  // TC-UT-CS-003: snapshot 应包含改动文件的内容
  it('TC-UT-CS-003: snapshot should contain file content after change', async () => {
    writeFileSync(join(projectRoot, 'app.ts'), 'export function foo() { return 42; }\n');
    const sensor = new DefaultChangeSensor(gitIntel);
    const batch = await sensor.detect(projectRoot);
    expect(batch).not.toBeNull();
    expect(batch!.snapshot['app.ts']).toContain('42');
  });
});
