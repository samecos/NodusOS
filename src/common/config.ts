// ============================================================
// Nodus 配置系统
// 支持从 ~/.nodus/config.json 读取、热加载与运行时修改。
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

export interface NodusConfig {
  projectPaths: string[];
  dbPath: string;
  locale: string;
  voice: {
    wakeWord: string;
    silentMode: boolean;
  };
  ui: {
    theme: 'dark' | 'light' | 'system';
  };
  env: {
    autoInstallRuntime: boolean;
    autoInstallDeps: boolean;
  };
  codeIntel: {
    excludePatterns: string[];
  };
}

export const DEFAULT_CONFIG: NodusConfig = {
  projectPaths: [process.cwd()],
  dbPath: join(homedir(), '.nodus', 'nodus.db'),
  locale: process.env.LANG?.startsWith('zh') ? 'zh-CN' : 'en-US',
  voice: {
    wakeWord: 'Nodus',
    silentMode: false,
  },
  ui: {
    theme: 'system',
  },
  env: {
    autoInstallRuntime: true,
    autoInstallDeps: true,
  },
  codeIntel: {
    excludePatterns: ['node_modules', '.git', 'dist', 'build', '__pycache__'],
  },
};

export interface ConfigManager {
  /** 获取完整配置 */
  get(): NodusConfig;
  /** 通过点分路径获取配置项，如 `voice.wakeWord` */
  get<T>(path: string): T | undefined;
  /** 通过点分路径设置配置项 */
  set<T>(path: string, value: T): void;
  /** 重新从磁盘加载 */
  reload(): void;
  /** 注册配置变更监听器，返回取消订阅函数 */
  onChange(listener: (config: NodusConfig) => void): () => void;
  /** 停止文件监听 */
  close(): void;
}

/** 基于 JSON 文件的配置管理器 */
export class JsonConfigManager implements ConfigManager {
  private config: NodusConfig;
  private configPath: string;
  private listeners = new Set<(config: NodusConfig) => void>();
  private watcher?: FSWatcher;
  private watchingFile = false;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private readonly debounceMs = 100;

  constructor(configPath = join(homedir(), '.nodus', 'config.json')) {
    this.configPath = configPath;
    this.config = this.load();
    this.watchConfig();
  }

  get(): NodusConfig;
  get<T>(path: string): T | undefined;
  get<T>(path?: string): NodusConfig | T | undefined {
    if (path === undefined) return this.config;
    const parts = path.split('.');
    let current: unknown = this.config;
    for (const part of parts) {
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current as T | undefined;
  }

  set<T>(path: string, value: T): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = this.config as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!(part in current) || current[part] === null || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]!] = value;
    this.persist();
    this.notify();
  }

  reload(): void {
    this.config = this.load();
    this.notify();
  }

  onChange(listener: (config: NodusConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.stopWatching();
    this.listeners.clear();
  }

  // ========== 内部辅助 ==========

  private stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    this.watchingFile = false;
  }

  private watchConfig(): void {
    if (existsSync(this.configPath)) {
      this.watchFile();
    } else {
      this.watchDirectory();
    }
  }

  private watchFile(): void {
    if (this.watchingFile) return;
    this.stopWatching();
    try {
      this.watcher = watch(this.configPath, () => this.debouncedReload());
      this.watcher.on('error', (err) => this.handleWatcherError(err));
      this.watchingFile = true;
    } catch (err) {
      console.error(`[Config] Failed to watch file ${this.configPath}: ${err}`);
      this.watchingFile = false;
    }
  }

  private watchDirectory(): void {
    if (!this.watchingFile && this.watcher) return; // 已在目录监听模式
    this.stopWatching();
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) return;
    try {
      this.watcher = watch(dir, (eventType, filename) => {
        if (filename !== null && filename !== basename(this.configPath)) return;
        this.debouncedReload();
      });
      this.watcher.on('error', (err) => this.handleWatcherError(err));
    } catch (err) {
      console.error(`[Config] Failed to watch directory ${dir}: ${err}`);
    }
  }

  private handleWatcherError(err: Error): void {
    console.error(`[Config] Watcher error: ${err.message}`);
    this.watcher = undefined;
    this.watchingFile = false;
    this.watchDirectory();
  }

  private debouncedReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      if (!existsSync(this.configPath)) {
        // 配置被删除或重命名，切回目录监听，保持当前配置不变，避免 reload() 重新创建文件
        this.watchDirectory();
        return;
      }
      this.reload();
      // 文件已存在，切换到文件级监听以减少同目录其他文件变更的干扰
      this.watchFile();
    }, this.debounceMs);
  }

  private load(): NodusConfig {
    if (!existsSync(this.configPath)) {
      this.ensureDir();
      this.persist(DEFAULT_CONFIG);
      return structuredClone(DEFAULT_CONFIG);
    }

    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<NodusConfig>;
      return this.mergeWithDefaults(parsed);
    } catch (err) {
      console.error(`[Config] Failed to load ${this.configPath}: ${err}`);
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  private persist(config = this.config): void {
    this.ensureDir();
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  private ensureDir(): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
  }

  private mergeWithDefaults(overrides: Partial<NodusConfig>): NodusConfig {
    return {
      ...DEFAULT_CONFIG,
      ...overrides,
      voice: { ...DEFAULT_CONFIG.voice, ...overrides.voice },
      ui: { ...DEFAULT_CONFIG.ui, ...overrides.ui },
      env: { ...DEFAULT_CONFIG.env, ...overrides.env },
      codeIntel: { ...DEFAULT_CONFIG.codeIntel, ...overrides.codeIntel },
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.config);
      } catch (err) {
        console.error(`[Config] Change listener error: ${err}`);
      }
    }
  }
}
