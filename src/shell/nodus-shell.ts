// ============================================================
// NodusShell — 应用入口，生命周期管理，模块注册，事件路由
// 与 ArchitecturalDesignPhase/04-API-Reference.md §2 一致
// ============================================================

import { SimpleEventBus } from './event-bus.impl.js';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { DefaultContextManager } from '../context/context-manager.impl.js';
import { CodeIntelligenceImpl } from '../code-intel/code-intelligence.impl.js';
import { EnvironmentManagerImpl } from '../env-mgr/environment-manager.impl.js';
import { GitIntelligenceImpl } from '../git-intel/git-intelligence.impl.js';
import { FileWatcherImpl } from '../file-watcher/file-watcher.impl.js';
import { PatternIntentEngine } from '../intent/intent-engine.impl.js';
import { SystemVoicePipeline } from '../voice/voice-pipeline.impl.js';
import { TerminalRenderer } from '../ui/terminal-renderer.js';
import type { EventBus } from './event-bus.js';
import type { UIRenderer } from '../ui/ui-renderer.js';
import type { ContextManager } from '../context/context-manager.js';
import type { CodeIntelligence } from '../code-intel/code-intelligence.js';
import type { EnvironmentManager } from '../env-mgr/environment-manager.js';
import type { GitIntelligence } from '../git-intel/git-intelligence.js';
import type { FileWatcher } from '../file-watcher/file-watcher.js';
import type { IntentEngine, QueryIntent } from '../intent/intent-engine.js';
import type { QueryResult } from '../code-intel/code-intelligence.js';
import type { VoicePipeline } from '../voice/voice-pipeline.js';

export interface NodusConfig {
  projectPaths: string[];
  dbPath?: string;
  locale?: string;
}

export class NodusShell {
  readonly eventBus: EventBus;
  readonly store: SqliteKnowledgeStore;
  readonly contextMgr: ContextManager;
  readonly codeIntel: CodeIntelligence;
  readonly envMgr: EnvironmentManager;
  readonly gitIntel: GitIntelligence;
  readonly fileWatcher: FileWatcher;
  readonly intentEngine: IntentEngine;
  readonly voicePipeline: VoicePipeline;
  readonly uiRenderer: UIRenderer;

  private config: NodusConfig;
  private modules = new Map<string, unknown>();

  constructor(config: NodusConfig) {
    this.config = config;
    this.eventBus = new SimpleEventBus();

    // Phase 1: 基础设施
    this.store = new SqliteKnowledgeStore(config.dbPath ?? ':memory:');
    this.contextMgr = new DefaultContextManager(config.projectPaths[0] ?? '/');

    // Phase 2: 能力模块
    this.codeIntel = new CodeIntelligenceImpl(this.store);
    this.gitIntel = new GitIntelligenceImpl();
    this.codeIntel.setGitIntel(this.gitIntel);
    this.envMgr = new EnvironmentManagerImpl();
    this.fileWatcher = new FileWatcherImpl(this.eventBus);

    // Phase 3: 编排模块
    this.intentEngine = new PatternIntentEngine();
    this.voicePipeline = new SystemVoicePipeline(this.eventBus);

    // Phase 4: 界面
    this.uiRenderer = new TerminalRenderer();

    // 注册模块到 registry
    this.modules.set('store', this.store);
    this.modules.set('context', this.contextMgr);
    this.modules.set('event_bus', this.eventBus);
    this.modules.set('code_intelligence', this.codeIntel);
    this.modules.set('environment', this.envMgr);
    this.modules.set('git', this.gitIntel);
    this.modules.set('file_watcher', this.fileWatcher);
    this.modules.set('intent', this.intentEngine);
    this.modules.set('voice', this.voicePipeline);
    this.modules.set('ui', this.uiRenderer);

    // 注册事件路由
    this.registerEventRoutes();
  }

  async bootstrap(): Promise<void> {
    console.log('[Nodus] Bootstrapping...');

    // 启动语音管线
    await this.voicePipeline.start();

    // 恢复上次会话 — 打开第一个项目
    for (const projectPath of this.config.projectPaths) {
      await this.openProject(projectPath);
    }

    console.log('[Nodus] Ready.');
  }

  /** 动态注册模块 */
  registerModule(name: string, module: unknown): void {
    this.modules.set(name, module);
  }

  /** 获取已注册的模块 */
  getModule<T>(name: string): T | undefined {
    return this.modules.get(name) as T | undefined;
  }

  async openProject(projectPath: string): Promise<void> {
    console.log(`[Nodus] Opening project: ${projectPath}`);

    try {
      // 检测项目
      const meta = await this.envMgr.detectProject(projectPath);

      // 发送事件
      this.eventBus.emit({ kind: 'project:opened', root: projectPath, meta });

      // 检查并安装依赖
      const runtimeStatus = await this.envMgr.checkRuntime(
        meta.languages[0] ?? 'typescript',
        meta.runtimes[0]?.constraint ?? '>=18.0.0',
      );
      const runtimeConstraint = meta.runtimes[0]?.constraint ?? '>=18.0.0';
      if (runtimeStatus.kind !== 'installed') {
        await this.envMgr.installRuntime(meta.languages[0] ?? 'typescript', runtimeConstraint);
      }
      await this.envMgr.installDependencies(meta);

      this.eventBus.emit({ kind: 'env:ready', meta });

      // 触发索引
      await this.codeIntel.indexProject(projectPath, meta.languages);
      this.eventBus.emit({
        kind: 'index:ready',
        symbol_count: (this.codeIntel.indexStatus() as { symbol_count?: number }).symbol_count ?? 0,
        duration_ms: 0,
      });

      // 开始监听文件变更
      const exts = meta.languages.flatMap(l => {
        if (l === 'typescript' || l === 'javascript') return ['*.ts', '*.tsx', '*.js', '*.jsx'];
        if (l === 'python') return ['*.py'];
        return [];
      });
      await this.fileWatcher.watch(projectPath, exts);

      console.log(`[Nodus] Project ready: ${meta.name} (${meta.languages.join(', ')})`);
    } catch (err) {
      console.error(`[Nodus] Failed to open project: ${err}`);
    }
  }

  async handleQuery(text: string): Promise<unknown> {
    const context = this.contextMgr.snapshot();
    const result = this.intentEngine.parse(
      { source: 'text', text, locale: this.config.locale ?? 'zh-CN' },
      context,
    );

    if ('kind' in result) {
      // IntentError
      return result;
    }

    this.contextMgr.recordQuery(text, result.intentType);
    const queryResult = await this.codeIntel.query(result);

    // 记录查询历史
    this.store.historyRecord({
      raw_text: text,
      intent_type: result.intentType,
      confidence: result.confidence,
      latency_ms: 0,
      result_count: this.countResults(queryResult),
      timestamp: new Date().toISOString(),
    });

    return queryResult;
  }

  async handleQueryFormatted(text: string): Promise<string> {
    const context = this.contextMgr.snapshot();
    const result = this.intentEngine.parse(
      { source: 'text', text, locale: this.config.locale ?? 'zh-CN' },
      context,
    );

    // Intent error — 直接格式化错误
    if ('kind' in result && !('intentType' in result)) {
      return this.uiRenderer.renderError(result as unknown as import('../intent/intent-engine.js').IntentError);
    }

    const intent = result as QueryIntent;
    this.contextMgr.recordQuery(text, intent.intentType);
    const queryResult = await this.codeIntel.query(intent);

    // 记录查询历史
    this.store.historyRecord({
      raw_text: text,
      intent_type: intent.intentType,
      confidence: intent.confidence,
      latency_ms: 0,
      result_count: this.countResults(queryResult),
      timestamp: new Date().toISOString(),
    });

    return this.uiRenderer.render(queryResult);
  }

  async shutdown(): Promise<void> {
    console.log('[Nodus] Shutting down...');
    this.fileWatcher.pause();
    await this.voicePipeline.stop();
    this.store.close();
    this.eventBus.clear();
    console.log('[Nodus] Goodbye.');
  }

  // ---- helpers ----

  private countResults(result: QueryResult): number {
    switch (result.kind) {
      case 'symbol_list':
      case 'symbol_overview':
        return result.symbols.length;
      case 'reference_list':
        return result.references.length;
      case 'call_graph':
        return result.graph.nodes.length;
      case 'impact_report':
        return result.report.directCallers.length;
      case 'change_history':
        return result.records.length;
      default:
        return 0;
    }
  }

  // ---- event routing ----

  private registerEventRoutes(): void {
    // File changes → incremental index
    this.eventBus.on('file:changed', (event) => {
      const path = event.path as string;
      const changeType = event.change_type as string;
      if (changeType !== 'deleted') {
        this.codeIntel.indexFile(path).catch(console.error);
      } else {
        this.store.symbolsRemove(path);
        this.store.refsRemoveForFile(path);
      }
    });

    // File deleted
    this.eventBus.on('file:deleted', (event) => {
      const path = event.path as string;
      this.store.symbolsRemove(path);
      this.store.refsRemoveForFile(path);
    });
  }
}
