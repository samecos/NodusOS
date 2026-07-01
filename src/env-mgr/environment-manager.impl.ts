// ============================================================
// EnvironmentManager 实现
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import type { Language, ProjectMeta, PackageManager, Framework, Dependency, RuntimeRequirement } from '../common/types.js';
import type { EnvironmentManager, RuntimeStatus, EnvStatus, DepInstallReport } from './environment-manager.js';
import { EnvError } from '../common/errors.js';

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
      throw new EnvError(EnvError.UNKNOWN_PROJECT_TYPE, `Unknown project type at ${path}`);
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
        this.currentStatus = { kind: 'ready', meta: this.cachedMeta! };
        return;
      }
    } catch {
      // checkRuntime 失败，继续尝试安装
    }

    const major = this.parseMajorVersion(version);

    try {
      if (language === 'typescript' || language === 'javascript') {
        await this.installNodeRuntime(major);
      } else if (language === 'python') {
        await this.installPythonRuntime(major);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[EnvMgr] Runtime installation failed: ${msg}`);
    }

    this.currentStatus = { kind: 'ready', meta: this.cachedMeta! };
  }

  private async installNodeRuntime(major: string): Promise<void> {
    // 优先使用版本管理器，避免污染系统全局运行时
    if (this.hasCommand('fnm')) {
      console.log(`[EnvMgr] Installing Node.js ${major}.x via fnm...`);
      this.exec(`fnm install ${major} 2>/dev/null || true`);
      this.exec(`fnm use ${major}`);
      return;
    }

    if (this.hasCommand('nvm')) {
      console.log(`[EnvMgr] Installing Node.js ${major}.x via nvm...`);
      this.exec(`source ~/.nvm/nvm.sh && nvm install ${major} 2>/dev/null || true`);
      this.exec(`source ~/.nvm/nvm.sh && nvm use ${major}`);
      return;
    }

    // 尝试系统包管理器（仅安装主版本，不覆盖用户已有版本）
    const os = platform();
    if (os === 'darwin' && this.hasCommand('brew')) {
      console.log(`[EnvMgr] Installing Node.js ${major}.x via brew...`);
      this.exec(`brew install node@${major} 2>/dev/null || brew install node`);
      return;
    }

    if (os === 'linux') {
      if (this.hasCommand('apt-get')) {
        console.log(`[EnvMgr] Installing Node.js via apt...`);
        this.exec('apt-get install -y nodejs npm');
        return;
      }
      if (this.hasCommand('dnf')) {
        console.log(`[EnvMgr] Installing Node.js via dnf...`);
        this.exec('dnf install -y nodejs');
        return;
      }
    }

    console.log(`[EnvMgr] Node.js ${major}.x required — please install via https://nodejs.org, fnm, or nvm`);
  }

  private async installPythonRuntime(major: string): Promise<void> {
    if (this.hasCommand('pyenv')) {
      console.log(`[EnvMgr] Installing Python ${major}.x via pyenv...`);
      this.exec(`pyenv install ${major}.latest 2>/dev/null || pyenv install ${major}`);
      return;
    }

    const os = platform();
    if (os === 'darwin' && this.hasCommand('brew')) {
      console.log(`[EnvMgr] Installing Python ${major}.x via brew...`);
      this.exec(`brew install python@${major} 2>/dev/null || brew install python`);
      return;
    }

    if (os === 'linux') {
      if (this.hasCommand('apt-get')) {
        console.log(`[EnvMgr] Installing Python via apt...`);
        this.exec('apt-get install -y python3 python3-pip');
        return;
      }
      if (this.hasCommand('dnf')) {
        console.log(`[EnvMgr] Installing Python via dnf...`);
        this.exec('dnf install -y python3 python3-pip');
        return;
      }
    }

    console.log(`[EnvMgr] Python ${major}.x required — please install via https://python.org or pyenv`);
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
        const venvPath = this.ensurePythonVenv(cwd);
        const pipPath = join(venvPath, 'bin', 'pip');
        const cmd = `"${pipPath}" install -r requirements.txt`;
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

  private parseMajorVersion(version: string): string {
    const clean = version.replace(/[^\d.]/g, '');
    return clean.split('.')[0] ?? '';
  }

  private hasCommand(command: string): boolean {
    try {
      execSync(`command -v ${command}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  private getPipCommand(): string {
    // macOS/Linux 上最可靠的方式：python3 -m pip
    if (this.hasCommand('python3')) return 'python3 -m pip';
    if (this.hasCommand('pip3')) return 'pip3';
    if (this.hasCommand('pip')) return 'pip';
    return 'python3 -m pip'; // 降级默认值，让错误信息更明确
  }

  private ensurePythonVenv(projectPath: string): string {
    const venvPath = join(projectPath, '.venv');

    // 如果已有激活的虚拟环境，直接使用
    if (process.env.VIRTUAL_ENV) {
      return process.env.VIRTUAL_ENV;
    }

    // 已存在 .venv 则复用
    if (existsSync(join(venvPath, 'bin', 'python'))) {
      return venvPath;
    }

    // 自动创建虚拟环境
    console.log(`[EnvMgr] Creating Python virtual environment at ${venvPath}`);
    execSync('python3 -m venv .venv', { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });

    return venvPath;
  }

  private exec(command: string): string {
    try {
      return execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new EnvError(EnvError.COMMAND_FAILED, `Command failed: ${command}\n${msg}`, { cause: err });
    }
  }
}
