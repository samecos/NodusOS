// ============================================================
// NodusShell — 应用入口，生命周期管理，模块注册，事件路由
// 与 ArchitecturalDesignPhase/04-API-Reference.md §2 一致
// ============================================================

import { NodusError, EnvError } from '../common/errors.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SimpleEventBus } from './event-bus.impl.js';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { DefaultContextManager } from '../context/context-manager.impl.js';
import { CodeIntelligenceImpl } from '../code-intel/code-intelligence.impl.js';
import { DefaultCodeReviewer } from '../code-review/code-reviewer.impl.js';
import { EnvironmentManagerImpl } from '../env-mgr/environment-manager.impl.js';
import { GitIntelligenceImpl } from '../git-intel/git-intelligence.impl.js';
import { FileWatcherImpl } from '../file-watcher/file-watcher.impl.js';
import { PatternIntentEngine } from '../intent/intent-engine.impl.js';
import { SystemVoicePipeline } from '../voice/voice-pipeline.impl.js';
import { TerminalRenderer } from '../ui/terminal-renderer.js';
import { QueryCache } from './query-cache.js';
import { RecommendationEngine } from './recommendation-engine.js';
import { DefaultDeviceSync } from '../sync/device-sync.impl.js';
import { DefaultChangeSensor } from '../change-sensor/change-sensor.impl.js';
import { CodeGeneratorImpl } from '../code-gen/code-generator.impl.js';
import { CrossDomainDebuggerImpl } from '../debug/cross-domain-debugger.impl.js';
import { TeamCollaborationImpl } from '../collab/team-collaboration.impl.js';
import { DefaultCodeAnalytics } from '../code-intel/code-analytics.impl.js';
import { DebtEngineImpl } from '../understanding-debt/debt-engine.impl.js';
import { SemanticChunkerImpl } from '../semantic-chunk/semantic-chunker.impl.js';
import { AlignmentFlywheelImpl } from '../alignment/alignment-flywheel.impl.js';
import { NodusMdEmitter } from '../alignment/emitters/nodus-md-emitter.js';
import { renderAnnotatedView } from '../overlay/annotated-view.js';
import type { EventBus } from './event-bus.js';
import type { DeviceSync } from '../sync/device-sync.js';
import { createErrorCard, type UIRenderer, type BreathLightState, type HistoryItem, type RecommendationItem } from '../ui/ui-renderer.js';
import type { ContextManager } from '../context/context-manager.js';
import type { CodeIntelligence } from '../code-intel/code-intelligence.js';
import type { EnvironmentManager } from '../env-mgr/environment-manager.js';
import type { GitIntelligence } from '../git-intel/git-intelligence.js';
import type { FileWatcher } from '../file-watcher/file-watcher.js';
import type { IntentEngine, QueryIntent } from '../intent/intent-engine.js';
import type { QueryResult } from '../code-intel/code-intelligence.js';
import type { VoicePipeline } from '../voice/voice-pipeline.js';
import type { ConfigManager, NodusConfig } from '../common/config.js';
import type { CodeGenerator } from '../code-gen/code-generator.js';
import type { CrossDomainDebugger } from '../debug/cross-domain-debugger.js';
import type { TeamCollaboration } from '../collab/team-collaboration.js';
import { basename, resolve } from 'node:path';

export { type NodusConfig } from '../common/config.js';

// ANSI 颜色常量 — 用于理解层内联输出
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

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
  readonly deviceSync: DeviceSync;
  readonly changeSensor: DefaultChangeSensor;
  readonly debtEngine: DebtEngineImpl;
  readonly chunker: SemanticChunkerImpl;
  readonly flywheel: AlignmentFlywheelImpl;
  readonly codeGenerator: CodeGenerator;
  readonly debugger: CrossDomainDebugger;
  readonly teamCollab: TeamCollaboration;

  private configManager: ConfigManager;
  private config: NodusConfig;
  private modules = new Map<string, unknown>();
  private unsubscribeConfig?: () => void;
  private isShutdown = false;
  private queryCache: QueryCache;
  private recommendationEngine: RecommendationEngine;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.config = configManager.get();
    this.eventBus = new SimpleEventBus();

    // 订阅配置变更，保持 this.config 最新并转发到事件总线
    // 注意：projectPaths 变更不会动态重新加载已打开的项目，仅 locale 等查询时字段即时生效
    this.unsubscribeConfig = configManager.onChange((cfg) => {
      this.config = cfg;
      this.eventBus.emit({ kind: 'config:changed', config: cfg });
    });

    // Phase 1: 基础设施
    this.store = new SqliteKnowledgeStore(this.config.dbPath ?? ':memory:');
    this.contextMgr = new DefaultContextManager(this.config.projectPaths[0] ?? '/');

    // Phase 2: 能力模块
    this.codeIntel = new CodeIntelligenceImpl(this.store);
    this.gitIntel = new GitIntelligenceImpl();
    this.codeIntel.setGitIntel(this.gitIntel);
    this.codeIntel.setCodeReviewer(new DefaultCodeReviewer());
    this.envMgr = new EnvironmentManagerImpl();
    this.fileWatcher = new FileWatcherImpl(this.eventBus);

    // Phase 3: 编排模块
    this.intentEngine = new PatternIntentEngine();
    this.voicePipeline = new SystemVoicePipeline(this.eventBus);

    // Phase 4: 界面 + 缓存 + 同步
    this.uiRenderer = new TerminalRenderer();
    this.queryCache = new QueryCache();
    this.recommendationEngine = new RecommendationEngine(this.store, this.contextMgr);
    this.deviceSync = new DefaultDeviceSync(this.store);

    // Phase 5: 理解层
    this.changeSensor = new DefaultChangeSensor(this.gitIntel);
    this.debtEngine = new DebtEngineImpl(this.store);
    this.chunker = new SemanticChunkerImpl();
    this.flywheel = new AlignmentFlywheelImpl(this.store, [new NodusMdEmitter()]);
    this.modules.set('change_sensor', this.changeSensor);
    this.modules.set('debt_engine', this.debtEngine);
    this.modules.set('chunker', this.chunker);
    this.modules.set('flywheel', this.flywheel);

    // Phase 6: 已接入 REPL 的扩展能力
    this.codeGenerator = new CodeGeneratorImpl(
      this.store,
      this.codeIntel,
      new DefaultCodeAnalytics(this.store, this.config.projectPaths[0] ?? process.cwd()),
    );
    this.debugger = new CrossDomainDebuggerImpl();
    this.teamCollab = new TeamCollaborationImpl();
    this.modules.set('code_generator', this.codeGenerator);
    this.modules.set('debugger', this.debugger);
    this.modules.set('team_collab', this.teamCollab);

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
    this.modules.set('device_sync', this.deviceSync);
    this.modules.set('config_manager', this.configManager);

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
    this.setBreathLight('idle');

    // 加载历史反馈学习
    const learned = this.intentEngine.loadFeedback();
    if (learned > 0) {
      console.log(`[Nodus] Learned ${learned} query patterns from feedback.`);
    }
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
      // 优先从 store 读取已持久化的项目元数据
      let meta = this.store.projectGetFull(projectPath);

      if (!meta) {
        // 检测项目并持久化
        meta = await this.envMgr.detectProject(projectPath);
        this.store.projectUpsertFull(meta);
      }

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

      // 恢复该项目上次会话状态
      const session = this.store.sessionStateGet(projectPath);
      if (session) {
        this.contextMgr.update({ kind: 'project_changed', root: projectPath });
        if (session.active_file) {
          this.contextMgr.update({ kind: 'file_opened', path: session.active_file });
          if (session.cursor_line != null && session.cursor_col != null) {
            this.contextMgr.update({
              kind: 'cursor_moved',
              file: session.active_file,
              line: session.cursor_line,
              col: session.cursor_col,
              symbol: session.cursor_symbol,
            });
          }
        }
      }

      console.log(`[Nodus] Project ready: ${meta.name} (${meta.languages.join(', ')})`);
    } catch (err) {
      const nodusErr = err instanceof NodusError
        ? err
        : new EnvError(EnvError.COMMAND_FAILED, `Failed to open project ${projectPath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      this.eventBus.emit({ kind: 'error', module: 'environment', error: nodusErr });
      console.error(this.uiRenderer.renderCard(createErrorCard(
        this.uiRenderer,
        nodusErr,
        'environment',
        '打开项目失败',
      )));
    }
  }

  async switchProject(projectPath: string): Promise<void> {
    console.log(`[Nodus] Switching to project: ${projectPath}`);

    // 1. 保存当前会话状态
    const ctx = this.contextMgr.snapshot();
    if (ctx.active_project_root) {
      this.store.sessionStateUpsert({
        project_root: ctx.active_project_root,
        active_file: ctx.active_file,
        cursor_line: ctx.cursor_line,
        cursor_col: ctx.cursor_col,
        cursor_symbol: ctx.cursor_symbol,
      });
    }

    // 2. 暂停当前文件监听
    this.fileWatcher.pause();

    // 3. 将新项目添加到配置列表（如尚未存在）
    const currentPaths = this.config.projectPaths;
    if (!currentPaths.includes(projectPath)) {
      this.configManager.set('projectPaths', [...currentPaths, projectPath]);
    }

    // 4. 更新上下文为待切换项目
    this.contextMgr.update({ kind: 'project_changed', root: projectPath });

    // 5. 打开新项目（含索引、文件监听、会话恢复）
    await this.openProject(projectPath);

    console.log(`[Nodus] Switched to project: ${projectPath}`);
  }

  listProjects(): Array<{ name: string; path: string; languages: string[]; active: boolean }> {
    const ctx = this.contextMgr.snapshot();
    return this.config.projectPaths.map((path) => {
      const meta = this.store.projectGetFull(path);
      return {
        name: meta?.name ?? basename(path),
        path,
        languages: meta?.languages ?? [],
        active: path === ctx.active_project_root,
      };
    });
  }

  private renderProjectList(list: ReturnType<typeof this.listProjects>): string {
    if (list.length === 0) {
      return '[Nodus] 当前未打开任何项目';
    }
    const lines = ['[Nodus] 已打开的项目：'];
    for (const p of list) {
      const marker = p.active ? '●' : '○';
      lines.push(`  ${marker} ${p.name} (${p.path})${p.languages.length > 0 ? ' [' + p.languages.join(', ') + ']' : ''}`);
    }
    return lines.join('\n');
  }

  async handleQuery(text: string): Promise<unknown> {
    this.eventBus.emit({ kind: 'query:received', text });

    try {
      const context = this.contextMgr.snapshot();
      const result = this.intentEngine.parse(
        { source: 'text', text, locale: this.config.locale ?? 'zh-CN' },
        context,
      );

      if ('kind' in result) {
        // IntentError
        return result;
      }

      // 项目切换意图拦截
      if (result.intentType === 'switch_project') {
        const targetPath = result.entities.projectPath;
        if (!targetPath) {
          return { kind: 'error', message: '未指定项目路径' };
        }
        await this.switchProject(targetPath);
        return { kind: 'switch_project', projectPath: targetPath };
      }

      if (result.intentType === 'list_projects') {
        return this.listProjects();
      }

      this.contextMgr.recordQuery(text, result.intentType);
      const queryResult = await this.codeIntel.query(result);
      this.eventBus.emit({ kind: 'query:result', result: queryResult });

      // 记录查询历史
      this.store.historyRecord({
        raw_text: text,
        intent_type: result.intentType,
        confidence: result.confidence,
        latency_ms: 0,
        result_count: this.countResults(queryResult),
        timestamp: new Date().toISOString(),
      });

      // 自动写入标注飞轮
      this.store.annotationRecord({
        input_text: text,
        intent_type: result.intentType,
        output_data: JSON.stringify(queryResult),
      });

      return queryResult;
    } catch (err) {
      const nodusErr = err instanceof NodusError
        ? err
        : new NodusError('SHELL_QUERY_FAILED', err instanceof Error ? err.message : String(err), { cause: err });
      this.eventBus.emit({ kind: 'error', module: 'shell', error: nodusErr });
      return createErrorCard(this.uiRenderer, nodusErr, 'shell', '查询失败');
    }
  }

  async handleQueryFormatted(text: string): Promise<string> {
    this.eventBus.emit({ kind: 'query:received', text });
    this.setBreathLight('thinking');

    try {
      // 缓存查找
      const context = this.contextMgr.snapshot();
      const cacheKey = QueryCache.buildKey(text, context);
      const cached = this.queryCache.get(cacheKey);
      if (cached) {
        this.setBreathLight('idle');
        return cached + ' \x1b[2m[cached]\x1b[0m';
      }

      const result = this.intentEngine.parse(
        { source: 'text', text, locale: this.config.locale ?? 'zh-CN' },
        context,
      );

      // Intent error — 直接格式化错误
      if ('kind' in result && !('intentType' in result)) {
        this.setBreathLight('idle');
        return this.uiRenderer.renderError(result as unknown as import('../intent/intent-engine.js').IntentError);
      }

      const intent = result as QueryIntent;

      // 项目切换意图拦截
      if (intent.intentType === 'switch_project') {
        const targetPath = intent.entities.projectPath;
        if (!targetPath) {
          this.setBreathLight('idle');
          return this.uiRenderer.renderCard(createErrorCard(
            this.uiRenderer,
            new NodusError('SHELL_QUERY_FAILED', '未指定项目路径'),
            'shell',
            '切换项目失败',
          ));
        }
        await this.switchProject(targetPath);
        this.setBreathLight('idle');
        return `[Nodus] 已切换到项目: ${targetPath}`;
      }

      if (intent.intentType === 'list_projects') {
        const list = this.listProjects();
        this.setBreathLight('idle');
        return this.renderProjectList(list);
      }

      // 理解层意图拦截
      if (intent.intentType === 'recent_changes') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const projectRoot = this.config.projectPaths[0] ?? '.';
        const batch = await this.changeSensor.detect(projectRoot);
        if (!batch) {
          this.setBreathLight('idle');
          return `${DIM}没有检测到未提交的变更。${RESET}\n`;
        }
        await this.debtEngine.recompute(batch);
        const chunks = this.chunker.chunk(batch);
        const briefs = chunks.map(c => this.chunker.brief(c, batch));
        const topDebts = this.debtEngine.getTopDebt(20);
        let out = this.uiRenderer.render({ kind: 'debt_heatmap', entries: topDebts });
        out += `\n${DIM}── ${chunks.length} 个语义块 ──${RESET}\n`;
        for (const b of briefs) {
          out += `  ${CYAN}[${b.chunk_id}]${RESET} ${b.title} · 风险 ${b.risk_level}`;
          if (b.suggested_inspect_point) {
            out += ` ${DIM}→ ${b.suggested_inspect_point.file}:${b.suggested_inspect_point.line}${RESET}`;
          }
          out += '\n';
        }
        this.queryCache.set(cacheKey, out);
        this.setBreathLight('idle');
        try {
          this.flywheel.emitConventions(projectRoot);
        } catch (err) {
          console.error('[understanding-layer] emitConventions failed:', err);
        }
        return out;
      }

      if (intent.intentType === 'view_annotated') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const filePath = intent.entities.filePath ?? '';
        const projectRoot = this.config.projectPaths[0] ?? '.';
        const fullPath = resolve(projectRoot, filePath);
        let code = '';
        try { code = readFileSync(fullPath, 'utf-8'); } catch {
          this.setBreathLight('idle');
          return `${RED}无法读取文件: ${filePath}${RESET}\n`;
        }
        const debts = this.debtEngine.getDebtByFile(filePath);
        // §4.2 examined 态：用户查看了标注视图即视为已审视，债值减半（仅未确认项）
        for (const d of debts) {
          if (!d.confirmed) {
            this.debtEngine.markExamined(d.symbol_id);
          }
        }
        const output = renderAnnotatedView(filePath, code, debts, []);
        const result = { kind: 'annotated_view' as const, filePath, content: code, output };
        this.setBreathLight('idle');
        return this.uiRenderer.render(result);
      }

      if (intent.intentType === 'chunk_brief') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const projectRoot = this.config.projectPaths[0] ?? '.';
        const batch = await this.changeSensor.detect(projectRoot);
        if (!batch) {
          this.setBreathLight('idle');
          return `${DIM}无变更。${RESET}\n`;
        }
        const chunks = this.chunker.chunk(batch);
        const idx = intent.entities.subType
          ? parseInt(intent.entities.subType.replace('chunk-', ''), 10)
          : 0;
        const chunk = chunks[idx] ?? chunks[0];
        if (!chunk) {
          this.setBreathLight('idle');
          return `${DIM}无语义块。${RESET}\n`;
        }
        const brief = this.chunker.brief(chunk, batch);
        // §4.2 examined 态：用户查看了 brief 即视为已审视，债值减半
        for (const s of chunk.symbols) {
          this.debtEngine.markExamined(s.symbol_id);
        }
        this.setBreathLight('idle');
        return this.uiRenderer.render({ kind: 'brief_card', brief });
      }

      if (intent.intentType === 'confirm_reviewed') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const symbolName = intent.entities.symbolName ?? '';
        if (!symbolName) {
          this.setBreathLight('idle');
          return `${YELLOW}请指定要确认的符号名。${RESET}\n`;
        }
        // 通过名称查找 symbol_id（debt_entries 的 PK 格式为 file:symbolName）
        const hit = this.debtEngine.getTopDebt(500).find(
          d => d.name === symbolName || d.symbol_id.endsWith(':' + symbolName),
        );
        if (!hit) {
          this.setBreathLight('idle');
          return `${YELLOW}未找到符号: ${symbolName}${RESET}\n`;
        }
        this.debtEngine.confirmReviewed(hit.symbol_id);
        this.setBreathLight('idle');
        return this.uiRenderer.render({ kind: 'confirmation', message: `已确认审查: ${hit.name}（债值清零）` });
      }

      if (intent.intentType === 'prune_conventions') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const tag = intent.entities.symbolName ?? '';
        if (!tag) {
          this.setBreathLight('idle');
          return this.uiRenderer.render({ kind: 'conventions_list', conventions: this.flywheel.listConventions() });
        }
        const deleted = this.flywheel.prune(tag);
        this.setBreathLight('idle');
        return this.uiRenderer.render({ kind: 'confirmation', message: deleted ? `已删除约定: ${tag}` : `未找到约定: ${tag}` });
      }

      // 代码生成与重构
      if (intent.intentType === 'code_generation') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const description = intent.entities.description ?? text;
        const symbolName = intent.entities.symbolName ?? this.contextMgr.snapshot().cursor_symbol ?? '';
        const activeFile = this.contextMgr.snapshot().active_file ?? '';
        const projectRoot = this.config.projectPaths[0] ?? '.';
        const targetFile = intent.entities.filePath
          ? resolve(projectRoot, intent.entities.filePath)
          : activeFile;

        let changes: import('../common/types.js').CodeChange[] = [];

        if (symbolName && /重构|refactor|rename|重命名|改写|rewrite/.test(description)) {
          const syms = await this.codeIntel.findSymbol(symbolName, undefined, undefined, 1);
          if (syms[0]) {
            const match = description.match(/(?:rename|重命名|改为|改成|to)\s+(\w+)/i);
            const newName = match?.[1] ?? `${symbolName}V2`;
            changes = await this.codeGenerator.generateRefactoring({
              type: 'rename',
              symbolId: syms[0].id,
              newName,
            });
          }
        } else if (symbolName && /提取|extract/.test(description)) {
          const syms = await this.codeIntel.findSymbol(symbolName, undefined, undefined, 1);
          if (syms[0]) {
            changes = await this.codeGenerator.generateRefactoring({
              type: 'extract_function',
              symbolId: syms[0].id,
              newName: 'extractedHelper',
              sourceCode: syms[0].location.file_path ? readFileSync(syms[0].location.file_path, 'utf-8') : undefined,
              startLine: syms[0].location.line_start,
              endLine: syms[0].location.line_end,
              targetFile: syms[0].location.file_path,
            });
          }
        } else if (targetFile) {
          changes = await this.codeGenerator.generateDiff({ filePath: targetFile, description });
        }

        if (changes.length === 0) {
          changes = (await this.codeGenerator.suggestImprovements(targetFile || undefined)).map(s => ({
            file_path: s.targetSymbol?.location.file_path ?? targetFile ?? '',
            change_type: 'modified' as const,
            diff_text: `[${s.severity}] ${s.type}: ${s.message}`,
          }));
        }

        const result: import('../code-intel/code-intelligence.js').QueryResult = { kind: 'code_generation', changes };
        this.queryCache.set(cacheKey, this.uiRenderer.render(result));
        this.setBreathLight('idle');
        return this.uiRenderer.render(result);
      }

      // 跨域调试
      if (intent.intentType === 'cross_domain_debug') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const logText = intent.entities.logText ?? text;
        const lines = logText.split(/\r?\n/).filter(l => l.trim());
        const entries: import('../debug/cross-domain-debugger.js').LogEntry[] = [];
        for (const line of lines) {
          const entry = this.debugger.parseLogLine(line);
          if (entry) entries.push(entry);
        }

        if (entries.length === 0) {
          this.setBreathLight('idle');
          return `${YELLOW}未能从输入中解析出日志/堆栈信息。${RESET}\n`;
        }

        const trace = this.debugger.traceError(entries);
        const correlated = await this.debugger.correlateLogWithCode(entries[0]!, this.codeIntel);
        const result: import('../code-intel/code-intelligence.js').QueryResult = { kind: 'cross_domain_debug', trace, correlated };
        this.queryCache.set(cacheKey, this.uiRenderer.render(result));
        this.setBreathLight('idle');
        return this.uiRenderer.render(result);
      }

      // 团队协作
      if (intent.intentType === 'team_collab_share') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const projectRoot = this.config.projectPaths[0] ?? '.';
        const json = await this.teamCollab.shareIndex(projectRoot, this.store);
        const result: import('../code-intel/code-intelligence.js').QueryResult = { kind: 'team_collab', action: 'share_index', result: json };
        this.queryCache.set(cacheKey, this.uiRenderer.render(result));
        this.setBreathLight('idle');
        return this.uiRenderer.render(result);
      }

      if (intent.intentType === 'team_collab_import') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const json = intent.entities.content ?? '';
        if (!json) {
          this.setBreathLight('idle');
          return `${YELLOW}请提供要导入的共享索引 JSON，例如粘贴 \`{\n  \"version\": \"1.0\"...\n}\`。${RESET}\n`;
        }
        const stats = await this.teamCollab.importSharedIndex(json, this.store);
        const result: import('../code-intel/code-intelligence.js').QueryResult = {
          kind: 'team_collab',
          action: 'import_index',
          result: `已导入: ${stats.symbols} 个符号, ${stats.references} 条引用, ${stats.annotations} 条注释`,
        };
        this.queryCache.set(cacheKey, this.uiRenderer.render(result));
        this.setBreathLight('idle');
        return this.uiRenderer.render(result);
      }

      if (intent.intentType === 'team_collab_annotate') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const symbolName = intent.entities.symbolName ?? '';
        const content = intent.entities.content ?? '';
        if (!symbolName || !content) {
          this.setBreathLight('idle');
          return `${YELLOW}请指定符号名和注释内容，例如：给 refundOrder 添加注释 "需要校验 order 状态"。${RESET}\n`;
        }
        const syms = await this.codeIntel.findSymbol(symbolName, undefined, undefined, 1);
        if (!syms[0]) {
          this.setBreathLight('idle');
          return `${YELLOW}未找到符号: ${symbolName}${RESET}\n`;
        }
        await this.teamCollab.addAnnotation({
          symbol_id: syms[0].id,
          content,
          author: process.env.USER ?? 'nodus-user',
        });
        const result: import('../code-intel/code-intelligence.js').QueryResult = {
          kind: 'team_collab',
          action: 'add_annotation',
          result: `已为 ${symbolName} 添加注释`,
        };
        this.queryCache.set(cacheKey, this.uiRenderer.render(result));
        this.setBreathLight('idle');
        return this.uiRenderer.render(result);
      }

      if (intent.intentType === 'team_collab_export') {
        this.contextMgr.recordQuery(text, intent.intentType);
        const projectRoot = this.config.projectPaths[0] ?? '.';
        const json = await this.teamCollab.exportTeamKnowledge(projectRoot, this.store);
        const result: import('../code-intel/code-intelligence.js').QueryResult = { kind: 'team_collab', action: 'export_team_knowledge', result: json };
        this.queryCache.set(cacheKey, this.uiRenderer.render(result));
        this.setBreathLight('idle');
        return this.uiRenderer.render(result);
      }

      this.contextMgr.recordQuery(text, intent.intentType);
      const queryResult = await this.codeIntel.query(intent);
      this.eventBus.emit({ kind: 'query:result', result: queryResult });

      // 记录查询历史
      this.store.historyRecord({
        raw_text: text,
        intent_type: intent.intentType,
        confidence: intent.confidence,
        latency_ms: 0,
        result_count: this.countResults(queryResult),
        timestamp: new Date().toISOString(),
      });

      // 自动写入标注飞轮
      this.store.annotationRecord({
        input_text: text,
        intent_type: intent.intentType,
        output_data: JSON.stringify(queryResult),
      });

      const output = this.uiRenderer.render(queryResult);
      this.queryCache.set(cacheKey, output);

      // 记录反馈用于学习闭环
      this.intentEngine.recordFeedback(
        { source: 'text', text, locale: this.config.locale ?? 'zh-CN' },
        intent,
        intent,
      );

      this.setBreathLight('idle');
      return output;
    } catch (err) {
      const nodusErr = err instanceof NodusError
        ? err
        : new NodusError('SHELL_QUERY_FAILED', err instanceof Error ? err.message : String(err), { cause: err });
      this.eventBus.emit({ kind: 'error', module: 'shell', error: nodusErr });
      this.setBreathLight('error');
      this.setBreathLight('idle');
      return this.uiRenderer.renderCard(createErrorCard(this.uiRenderer, nodusErr, 'shell', '查询失败'));
    }
  }

  async shutdown(): Promise<void> {
    if (this.isShutdown) {
      return;
    }
    this.isShutdown = true;

    console.log('[Nodus] Shutting down...');

    try {
      // 保存当前会话状态
      const ctx = this.contextMgr.snapshot();
      if (ctx.active_project_root) {
        this.store.sessionStateUpsert({
          project_root: ctx.active_project_root,
          active_file: ctx.active_file,
          cursor_line: ctx.cursor_line,
          cursor_col: ctx.cursor_col,
          cursor_symbol: ctx.cursor_symbol,
        });
      }
    } finally {
      this.fileWatcher.pause();
      await this.voicePipeline.stop().catch(() => {});
      this.unsubscribeConfig?.();
      this.store.close();
      this.eventBus.clear();
      console.log('[Nodus] Goodbye.');
    }
  }

  // ---- helpers ----

  private setBreathLight(state: BreathLightState): void {
    this.uiRenderer.setBreathLight(state);
    this.eventBus.emit({ kind: 'ui:state_changed', state });
  }

  /** 获取最近查询历史，返回渲染好的字符串 */
  getHistory(limit = 10): string {
    const entries = this.store.historyRecent(limit);
    const items: HistoryItem[] = entries.map(e => ({
      text: e.raw_text,
      intentType: e.intent_type ?? null,
      timestamp: e.timestamp,
    }));
    return this.uiRenderer.renderHistory(items);
  }

  /** 获取推荐，返回渲染好的字符串 */
  getRecommendations(): string {
    const recs = this.recommendationEngine.generate();
    const items: RecommendationItem[] = recs.map(r => ({
      text: r.text,
      reason: r.reason,
    }));
    return this.uiRenderer.renderRecommendations(items);
  }

  /** 获取推荐原始数据（供 REPL 序号执行使用） */
  getRecommendationList(): RecommendationItem[] {
    const recs = this.recommendationEngine.generate();
    return recs.map(r => ({ text: r.text, reason: r.reason }));
  }

  /** 从 feedback.jsonl 重新加载学习例句，返回新学习数量 */
  learnFeedback(): number {
    return this.intentEngine.loadFeedback();
  }

  /** 返回已学习例句数量 */
  getLearnedCount(): number {
    return this.intentEngine.getLearnedCount();
  }

  /** 获取项目列表的格式化字符串 */
  getProjectList(): string {
    return this.renderProjectList(this.listProjects());
  }

  /** 提交手动反馈，保存到 feedback.jsonl（不参与学习闭环，仅作记录） */
  recordManualFeedback(text: string): void {
    try {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
      const dir = join(home, '.nodus');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const entry = {
        timestamp: new Date().toISOString(),
        input_text: text,
        input_source: 'manual_feedback',
        parsed_intent: null,
        parsed_confidence: null,
        actual_intent: 'feedback',
        actual_entities: {},
      };
      appendFileSync(join(dir, 'feedback.jsonl'), JSON.stringify(entry) + '\n');
    } catch {
      // 静默失败 — 反馈记录不影响主流程
    }
  }

  /** 导出多设备同步数据 */
  exportSyncData(): import('../common/types.js').SyncData {
    return this.deviceSync.exportSyncData();
  }

  /** 导入多设备同步数据 */
  importSyncData(data: import('../common/types.js').SyncData): import('../sync/device-sync.js').SyncResult {
    return this.deviceSync.importSyncData(data);
  }

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
      case 'review_report':
        return result.report.comments.length;
      case 'code_generation':
        return result.changes.length;
      case 'cross_domain_debug':
        return result.trace.stackFrames.length;
      case 'team_collab':
        return result.result.length;
      default:
        return 0;
    }
  }

  // ---- event routing ----

  private registerEventRoutes(): void {
    // File changes → incremental index
    this.eventBus.on('file:changed', (event) => {
      this.codeIntel.indexFile(event.path).catch(console.error);
    });

    // File deleted → 清理索引
    this.eventBus.on('file:deleted', (event) => {
      this.store.symbolsRemove(event.path);
      this.store.refsRemoveForFile(event.path);
      this.store.fileStateRemove(event.path);
    });

    // 查询事件 → 可扩展为 UI 更新、历史记录等
    this.eventBus.on('query:received', (_event) => {
      // 实际查询处理在 handleQuery / handleQueryFormatted 中完成
    });

    // 错误事件 → 统一降级卡片
    this.eventBus.on('error', (event) => {
      this.setBreathLight('error');
      const card = createErrorCard(
        this.uiRenderer,
        event.error,
        event.module,
        '运行降级提示',
      );
      console.error(this.uiRenderer.renderCard(card));
    });
  }
}
