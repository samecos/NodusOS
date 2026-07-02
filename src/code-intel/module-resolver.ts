import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export interface TsConfigPaths {
  [alias: string]: string[];
}

/** 把 import source 解析为项目内绝对文件路径 */
export class ModuleResolver {
  private projectRoot: string;
  private baseUrl: string;
  private paths: TsConfigPaths = {};

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.baseUrl = projectRoot;
    this.loadTsConfig();
  }

  /** 解析 import source，失败返回 undefined（代表外部包） */
  resolve(source: string, fromFile: string): string | undefined {
    if (source.startsWith('.')) {
      return this.resolveRelative(source, fromFile);
    }
    const tsResolved = this.resolveTsConfigPaths(source);
    if (tsResolved) return tsResolved;
    return undefined;
  }

  private loadTsConfig(): void {
    const tsconfigPath = join(this.projectRoot, 'tsconfig.json');
    if (!existsSync(tsconfigPath)) return;
    try {
      const raw = readFileSync(tsconfigPath, 'utf-8');
      const config = JSON.parse(raw) as { compilerOptions?: { baseUrl?: string; paths?: TsConfigPaths } };
      const compilerOptions = config.compilerOptions ?? {};
      this.baseUrl = compilerOptions.baseUrl
        ? resolve(this.projectRoot, compilerOptions.baseUrl)
        : this.projectRoot;
      this.paths = compilerOptions.paths ?? {};
    } catch {
      // tsconfig 解析失败时降级为无 paths
    }
  }

  private resolveRelative(source: string, fromFile: string): string | undefined {
    const fromDir = existsSync(fromFile) && statSync(fromFile).isDirectory()
      ? fromFile
      : dirname(fromFile);
    const base = resolve(fromDir, source);
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    if (existsSync(base) && statSync(base).isFile()) return base;

    for (const ext of extensions) {
      const candidate = `${base}${ext}`;
      if (existsSync(candidate)) return candidate;
    }

    for (const ext of extensions) {
      const candidate = join(base, `index${ext}`);
      if (existsSync(candidate)) return candidate;
    }

    return undefined;
  }

  private resolveTsConfigPaths(source: string): string | undefined {
    for (const [alias, targets] of Object.entries(this.paths)) {
      const captured = this.matchAlias(source, alias);
      if (captured === null) continue;

      for (const target of targets) {
        const mapped = this.applyAliasTarget(target, captured);
        const resolved = this.resolveRelative(mapped, this.baseUrl);
        if (resolved) return resolved;
      }
    }
    return undefined;
  }

  /** 返回匹配后捕获的通配符部分；不匹配返回 null */
  private matchAlias(source: string, alias: string): string | null {
    if (!alias.endsWith('/*')) {
      return source === alias ? '' : null;
    }
    const prefix = alias.slice(0, -1); // 保留末尾斜杠，例如 "@/"
    if (!source.startsWith(prefix)) return null;
    return source.slice(prefix.length);
  }

  private applyAliasTarget(target: string, captured: string): string {
    if (target.includes('*')) {
      return target.replace('*', captured);
    }
    return captured ? `${target}/${captured}` : target;
  }
}
