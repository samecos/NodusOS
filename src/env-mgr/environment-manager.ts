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

/** 外部服务类型 */
export type ExternalServiceType = 'postgresql' | 'mysql' | 'redis' | 'docker' | 'mongodb';

/** 外部服务状态 */
export type ExternalServiceStatus =
  | { kind: 'not_detected' }
  | { kind: 'config_found'; config_source: string }
  | { kind: 'running'; port: number; version?: string }
  | { kind: 'missing'; config_source: string; hint: string };

/** 外部服务信息 */
export interface ExternalService {
  type: ExternalServiceType;
  status: ExternalServiceStatus;
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

  /** 检测外部服务（数据库 / Redis / Docker / MongoDB） */
  detectExternalServices(projectPath: string): Promise<ExternalService[]>;

  /** 检查指定服务状态 */
  checkServiceStatus(type: ExternalServiceType, port?: number): Promise<ExternalServiceStatus>;

  /** 获取启动建议（返回启动命令或说明） */
  startService(service: ExternalService): Promise<string>;
}
