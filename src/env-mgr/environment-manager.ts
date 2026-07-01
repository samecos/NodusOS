// ============================================================
// EnvironmentManager — 环境检测与安装
// 与 ArchitecturalDesignPhase/04-API-Reference.md §6 一致
// ============================================================

import type { Language, ProjectMeta, PackageManager, Framework, RuntimeRequirement } from '../common/types.js';

export type RuntimeStatus =
  | { kind: 'installed'; version: string; path: string }
  | { kind: 'not_installed'; required: string }
  | { kind: 'outdated'; current: string; required: string };

export type EnvStatus =
  | { kind: 'detecting' }
  | { kind: 'runtime_missing'; language: Language; needed: string }
  | { kind: 'installing_runtime'; language: Language; progress: number }
  | { kind: 'installing_deps'; progress: number; current: string }
  | { kind: 'ready'; meta: ProjectMeta }
  | { kind: 'error'; message: string };

export interface DepInstallReport {
  packagesInstalled: number;
  packagesCached: number;
  durationMs: number;
  warnings: string[];
}

export interface EnvironmentManager {
  /** 检测项目类型 */
  detectProject(path: string): Promise<ProjectMeta>;

  /** 检查运行时状态 */
  checkRuntime(language: Language, requiredVersion: string): Promise<RuntimeStatus>;

  /** 安装运行时 */
  installRuntime(language: Language, version: string): Promise<void>;

  /** 安装项目依赖 */
  installDependencies(project: ProjectMeta): Promise<DepInstallReport>;

  /** 当前环境状态 */
  status(): EnvStatus;

  /** 检测包管理器 */
  detectPackageManager(path: string): PackageManager | null;
}
