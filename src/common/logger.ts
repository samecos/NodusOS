// ============================================================
// Nodus 统一日志系统
// 默认写入 ~/.nodus/logs/nodus-YYYY-MM-DD.log
// ============================================================

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(module: string, message: string, context?: Record<string, unknown>): void;
  info(module: string, message: string, context?: Record<string, unknown>): void;
  warn(module: string, message: string, context?: Record<string, unknown>): void;
  error(module: string, message: string, context?: Record<string, unknown>): void;
}

export interface FileLoggerOptions {
  logDir?: string;
  console?: boolean;
  minLevel?: LogLevel;
}

export class FileLogger implements Logger {
  private logDir: string;
  private logToConsole: boolean;
  private minLevel: LogLevel;
  private levelRank: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

  constructor(options: FileLoggerOptions = {}) {
    this.logDir = options.logDir ?? join(homedir(), '.nodus', 'logs');
    this.logToConsole = options.console ?? true;
    this.minLevel = options.minLevel ?? 'info';
    this.ensureDir();
  }

  debug(module: string, message: string, context?: Record<string, unknown>): void {
    this.log('debug', module, message, context);
  }

  info(module: string, message: string, context?: Record<string, unknown>): void {
    this.log('info', module, message, context);
  }

  warn(module: string, message: string, context?: Record<string, unknown>): void {
    this.log('warn', module, message, context);
  }

  error(module: string, message: string, context?: Record<string, unknown>): void {
    this.log('error', module, message, context);
  }

  private log(level: LogLevel, module: string, message: string, context?: Record<string, unknown>): void {
    if (this.levelRank[level] < this.levelRank[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      context,
    };

    const line = this.format(entry);

    if (this.logToConsole) {
      const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      consoleMethod(line);
    }

    try {
      appendFileSync(this.currentLogFile(), line + '\n', 'utf-8');
    } catch (err) {
      // 日志写入失败时避免递归报错
      console.error(`[Logger] Failed to write log: ${err}`);
    }
  }

  private format(entry: LogEntry): string {
    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}${ctx}`;
  }

  private currentLogFile(): string {
    const date = new Date().toISOString().slice(0, 10);
    return join(this.logDir, `nodus-${date}.log`);
  }

  private ensureDir(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }
}

/** 全局默认 logger 实例 */
export const defaultLogger = new FileLogger();
