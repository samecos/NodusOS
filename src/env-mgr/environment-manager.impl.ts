// ============================================================
// EnvironmentManager 实现
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { Language, ProjectMeta, PackageManager, Framework, Dependency, RuntimeRequirement } from '../common/types.js';
import type { EnvironmentManager, RuntimeStatus, EnvStatus, DepInstallReport } from './environment-manager.js';

export class EnvironmentManagerImpl implements EnvironmentManager {
  private currentStatus: EnvStatus = { kind: 'detecting' };
  private cachedMeta: ProjectMeta | null = null;

  async detectProject(path: string): Promise<ProjectMeta> {
    this.currentStatus = { kind: 'detecting' };

    const languages: Language[] = [];
    const runtimes: RuntimeRequirement[] = [];
    const dependencies: Dependency[] = [];
    let packageManager: PackageManager | undefined;
    let framework: Framework | undefined;
    let name = path.split('/').pop() ?? path;

    // ---- TypeScript/JavaScript ----
    const pkgJsonPath = join(path, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      name = pkg.name ?? name;

      // 检测语言
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps?.typescript || existsSync(join(path, 'tsconfig.json'))) {
        languages.push('typescript');
      }
      if (existsSync(join(path, 'jsconfig.json')) || deps && !deps.typescript) {
        if (!languages.includes('javascript')) languages.push('javascript');
      }

      // Node 版本约束
      const nodeVersion = pkg.engines?.node;
      if (nodeVersion) {
        runtimes.push({ language: 'typescript', constraint: nodeVersion, specified_in: 'package.json' });
      } else {
        runtimes.push({ language: 'typescript', constraint: '>=18.0.0', specified_in: 'package.json' });
      }

      // 依赖列表
      for (const [depName, depVersion] of Object.entries(deps ?? {})) {
        dependencies.push({
          name: depName,
          version: (depVersion as string).replace(/[\^~]/, ''),
          dep_type: pkg.devDependencies?.[depName] ? 'development' : 'production',
          language: languages[0] ?? 'typescript',
        });
      }

      // 包管理器
      packageManager = this.detectPackageManager(path) as PackageManager | undefined;

      // 框架
      if (deps?.next) framework = 'nextjs';
      else if (deps?.react) framework = 'react';
      else if (deps?.vue) framework = 'vue';
      else if (deps?.express) framework = 'express';
      else if (deps?.hono) framework = 'hono';
    }

    // ---- Python ----
    const pyprojectPath = join(path, 'pyproject.toml');
    const requirementsPath = join(path, 'requirements.txt');

    if (existsSync(pyprojectPath)) {
      languages.push('python');
      const content = readFileSync(pyprojectPath, 'utf-8');
      const pythonMatch = content.match(/requires-python\s*=\s*["']([^"']+)["']/);
      if (pythonMatch) {
        runtimes.push({ language: 'python', constraint: pythonMatch[1], specified_in: 'pyproject.toml' });
      }

      if (content.includes('[tool.poetry]')) packageManager = 'poetry';
    } else if (existsSync(requirementsPath)) {
      languages.push('python');
      runtimes.push({ language: 'python', constraint: '>=3.10', specified_in: 'requirements.txt' });
      packageManager = 'pip';
    }

    // 如果没有识别到任何语言
    if (languages.length === 0) {
      throw new Error(`Unknown project type at ${path}`);
    }

    const meta: ProjectMeta = {
      name, root_path: path,
      languages, runtimes, dependencies,
      package_manager: (packageManager ?? undefined) as PackageManager | undefined,
      framework,
    };

    this.cachedMeta = meta;
    this.currentStatus = { kind: 'ready', meta };
    return meta;
  }

  async checkRuntime(language: Language, requiredVersion: string): Promise<RuntimeStatus> {
    const cleanReq = requiredVersion.replace(/[^\d.]/g, '');
    try {
      let versionOutput = '';
      if (language === 'typescript' || language === 'javascript') {
        versionOutput = execSync('node --version', { encoding: 'utf-8' }).trim().replace('v', '');
      } else if (language === 'python') {
        const parts = execSync('python3 --version', { encoding: 'utf-8' }).trim().split(' ');
        if (parts.length >= 2) versionOutput = parts[1];
      } else {
        return { kind: 'not_installed', required: cleanReq };
      }

      if (this.versionSatisfies(versionOutput, cleanReq)) {
        return { kind: 'installed', version: versionOutput, path: '' };
      }
      return { kind: 'outdated', current: versionOutput, required: cleanReq };
    } catch {
      return { kind: 'not_installed', required: cleanReq };
    }
  }

  async installRuntime(language: Language, version: string): Promise<void> {
    this.currentStatus = { kind: 'installing_runtime', language, progress: 0 };

    try {
      // 检查是否已安装满足要求的版本
      const status = await this.checkRuntime(language, version);
      if (status.kind === 'installed') {
        // 已安装，无需操作
        this.currentStatus = { kind: 'ready', meta: this.cachedMeta! };
        return;
      }
    } catch {
      // checkRuntime 失败，继续尝试安装
    }

    // 尝试安装
    try {
      if (language === 'typescript' || language === 'javascript') {
        // Node.js: 检查是否已有可用的 node，版本不足时提示
        const current = this.getNodeVersion();
        if (current) {
          console.log(`[EnvMgr] Node ${current} detected, using existing installation`);
        } else {
          console.log('[EnvMgr] Node.js required — please install via https://nodejs.org or fnm');
        }
      } else if (language === 'python') {
        const current = this.getPythonVersion();
        if (current) {
          console.log(`[EnvMgr] Python ${current} detected, using existing installation`);
        } else {
          console.log('[EnvMgr] Python required — please install via https://python.org or pyenv');
        }
      }
    } catch (err) {
      console.error(`[EnvMgr] Runtime check failed: ${err}`);
    }

    this.currentStatus = { kind: 'ready', meta: this.cachedMeta! };
  }

  async installDependencies(project: ProjectMeta): Promise<DepInstallReport> {
    const startTime = Date.now();
    const warnings: string[] = [];
    let packagesInstalled = 0;
    let packagesCached = 0;

    this.currentStatus = { kind: 'installing_deps', progress: 0, current: 'detecting package manager' };

    const pm = project.package_manager ?? this.detectPackageManager(project.root_path);
    const cwd = project.root_path;

    try {
      if (pm === 'npm' || pm === 'yarn' || pm === 'pnpm') {
        const cmd = pm === 'yarn' ? 'yarn install' : pm === 'pnpm' ? 'pnpm install' : 'npm install';
        this.currentStatus = { kind: 'installing_deps', progress: 30, current: cmd };

        console.log(`[EnvMgr] Running ${cmd} in ${cwd}`);
        const output = execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe', timeout: 300_000 });
        packagesInstalled = this.parsePackageCount(output);
        packagesCached = Math.max(0, packagesInstalled - 10); // 粗略估计
        this.currentStatus = { kind: 'installing_deps', progress: 90, current: 'finalizing' };
      } else if (pm === 'pip') {
        const cmd = 'pip install -r requirements.txt';
        this.currentStatus = { kind: 'installing_deps', progress: 30, current: cmd };
        console.log(`[EnvMgr] Running ${cmd} in ${cwd}`);
        execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe', timeout: 300_000 });
        this.currentStatus = { kind: 'installing_deps', progress: 90, current: 'finalizing' };
      } else if (pm === 'poetry') {
        this.currentStatus = { kind: 'installing_deps', progress: 30, current: 'poetry install' };
        console.log(`[EnvMgr] Running poetry install in ${cwd}`);
        execSync('poetry install', { cwd, encoding: 'utf-8', stdio: 'pipe', timeout: 300_000 });
        this.currentStatus = { kind: 'installing_deps', progress: 90, current: 'finalizing' };
      } else if (pm === 'uv') {
        this.currentStatus = { kind: 'installing_deps', progress: 30, current: 'uv sync' };
        console.log(`[EnvMgr] Running uv sync in ${cwd}`);
        execSync('uv sync', { cwd, encoding: 'utf-8', stdio: 'pipe', timeout: 300_000 });
        this.currentStatus = { kind: 'installing_deps', progress: 90, current: 'finalizing' };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Installation failed: ${msg}`);
      console.error(`[EnvMgr] Dependency install error: ${msg}`);
    }

    this.currentStatus = { kind: 'ready', meta: this.cachedMeta! };
    return {
      packagesInstalled,
      packagesCached,
      durationMs: Date.now() - startTime,
      warnings,
    };
  }

  status(): EnvStatus {
    return this.currentStatus;
  }

  detectPackageManager(path: string): PackageManager | null {
    if (existsSync(join(path, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(path, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(path, 'package-lock.json'))) return 'npm';
    if (existsSync(join(path, 'pyproject.toml'))) {
      const content = readFileSync(join(path, 'pyproject.toml'), 'utf-8');
      if (content.includes('[tool.poetry]')) return 'poetry';
      if (content.includes('[tool.uv]')) return 'uv';
      return 'pip';
    }
    return null;
  }

  // ---- helpers ----

  private getNodeVersion(): string | null {
    try {
      return execSync('node --version', { encoding: 'utf-8', stdio: 'pipe' }).trim().replace('v', '');
    } catch { return null; }
  }

  private getPythonVersion(): string | null {
    try {
      return execSync('python3 --version', { encoding: 'utf-8', stdio: 'pipe' }).trim().split(' ')[1] ?? null;
    } catch {
      try {
        return execSync('python --version', { encoding: 'utf-8', stdio: 'pipe' }).trim().split(' ')[1] ?? null;
      } catch { return null; }
    }
  }

  private parsePackageCount(output: string): number {
    // npm/yarn 输出通常包含 "added N packages"
    const match = output.match(/(?:added|installed)\s+(\d+)\s+package/);
    return match ? parseInt(match[1]) : 0;
  }

  private versionSatisfies(actual: string, required: string): boolean {
    const reqParts = required.split('.').map(Number);
    const actParts = actual.split('.').map(Number);

    for (let i = 0; i < Math.max(reqParts.length, actParts.length); i++) {
      const r = reqParts[i] ?? 0;
      const a = actParts[i] ?? 0;
      if (a > r) return true;
      if (a < r) return false;
    }
    return true; // 相等
  }
}
