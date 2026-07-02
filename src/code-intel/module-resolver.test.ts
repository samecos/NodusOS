import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModuleResolver } from './module-resolver.js';

const TMP = join(tmpdir(), `nodus-module-resolver-${Date.now()}`);

beforeEach(() => {
  mkdirSync(join(TMP, 'src', 'utils'), { recursive: true });
  writeFileSync(join(TMP, 'src', 'payment.ts'), 'export function refund(): void {}');
  writeFileSync(join(TMP, 'src', 'utils', 'index.ts'), 'export * from "./format";');
  writeFileSync(join(TMP, 'src', 'utils', 'format.ts'), 'export function formatCurrency(n: number): string { return ""; }');
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('ModuleResolver', () => {
  it('TC-UT-MR-001: 解析相对文件路径', () => {
    const resolver = new ModuleResolver(TMP);
    const resolved = resolver.resolve('./payment', join(TMP, 'src', 'app.ts'));
    expect(resolved).toBe(join(TMP, 'src', 'payment.ts'));
  });

  it('TC-UT-MR-002: 解析相对目录到 index.ts', () => {
    const resolver = new ModuleResolver(TMP);
    const resolved = resolver.resolve('./utils', join(TMP, 'src', 'app.ts'));
    expect(resolved).toBe(join(TMP, 'src', 'utils', 'index.ts'));
  });

  it('TC-UT-MR-003: 解析 tsconfig paths 别名', () => {
    writeFileSync(join(TMP, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
    }));
    const resolver = new ModuleResolver(TMP);
    const resolved = resolver.resolve('@/payment', join(TMP, 'src', 'app.ts'));
    expect(resolved).toBe(join(TMP, 'src', 'payment.ts'));
  });

  it('TC-UT-MR-004: 外部包返回 undefined', () => {
    const resolver = new ModuleResolver(TMP);
    expect(resolver.resolve('lodash', join(TMP, 'src', 'app.ts'))).toBeUndefined();
  });
});
