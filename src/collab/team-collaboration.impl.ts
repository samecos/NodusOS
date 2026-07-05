// ============================================================
// TeamCollaboration 实现 — JSON 共享格式，文件系统存储注释
// ============================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type {
  TeamCollaboration, SymbolAnnotation, SharedIndex,
} from './team-collaboration.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { Symbol, Reference } from '../common/types.js';
import { CollabError } from '../common/errors.js';

const SHARED_INDEX_VERSION = '1.0';

interface AnnotationsFile {
  version: string;
  annotations: SymbolAnnotation[];
}

export class TeamCollaborationImpl implements TeamCollaboration {
  private annotationsPath: string;

  constructor(annotationsPath?: string) {
    this.annotationsPath = annotationsPath ?? join(homedir(), '.nodus', 'annotations.json');
    this.ensureAnnotationsDir();
  }

  // ---- shareIndex ----

  async shareIndex(projectPath: string, store: KnowledgeStore): Promise<string> {
    const meta = store.projectGetFull(projectPath);
    if (!meta) {
      throw new CollabError(
        CollabError.FILE_NOT_FOUND,
        `项目未在知识库中建立索引: ${projectPath}`,
      );
    }

    const allSymbols = store.symbolsFindAll();
    const projectSymbols = this.filterProjectSymbols(allSymbols, projectPath);

    const allRefs = store.refsFindAll();
    const projectRefs = this.filterProjectReferences(allRefs, projectPath);

    const shared: SharedIndex = {
      version: SHARED_INDEX_VERSION,
      exported_at: new Date().toISOString(),
      project_meta: meta,
      symbols: projectSymbols,
      references: projectRefs,
    };

    return JSON.stringify(shared, null, 2);
  }

  // ---- importSharedIndex ----

  async importSharedIndex(
    json: string,
    store: KnowledgeStore,
  ): Promise<{ symbols: number; references: number; annotations: number }> {
    let shared: SharedIndex;
    try {
      shared = JSON.parse(json) as SharedIndex;
    } catch (err) {
      throw new CollabError(
        CollabError.INVALID_JSON,
        '共享索引 JSON 解析失败，请检查格式。',
        { cause: err },
      );
    }

    if (!shared.version || !shared.symbols || !Array.isArray(shared.references)) {
      throw new CollabError(
        CollabError.INVALID_JSON,
        '共享索引缺少必需字段（version / symbols / references）。',
      );
    }

    if (shared.symbols.length > 0) {
      store.symbolsUpsert(shared.symbols);
    }

    if (shared.references.length > 0) {
      store.refsUpsert(shared.references);
    }

    let annotationsCount = 0;
    if (shared.annotations && shared.annotations.length > 0) {
      const existing = this.loadAnnotations();
      const merged = [...existing.annotations];
      for (const ann of shared.annotations) {
        if (!merged.find(a => a.id === ann.id)) {
          merged.push(ann);
          annotationsCount++;
        }
      }
      this.saveAnnotations({ version: existing.version, annotations: merged });
    }

    return {
      symbols: shared.symbols.length,
      references: shared.references.length,
      annotations: annotationsCount,
    };
  }

  // ---- addAnnotation ----

  async addAnnotation(
    annotation: Omit<SymbolAnnotation, 'id' | 'created_at'>,
  ): Promise<SymbolAnnotation> {
    const created: SymbolAnnotation = {
      ...annotation,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };

    const data = this.loadAnnotations();
    data.annotations.push(created);
    this.saveAnnotations(data);

    return created;
  }

  // ---- listAnnotations ----

  async listAnnotations(symbolId?: string): Promise<SymbolAnnotation[]> {
    const data = this.loadAnnotations();
    if (!symbolId) return data.annotations;
    return data.annotations.filter(a => a.symbol_id === symbolId);
  }

  // ---- exportTeamKnowledge ----

  async exportTeamKnowledge(
    projectPath: string,
    store: KnowledgeStore,
  ): Promise<string> {
    const baseJson = await this.shareIndex(projectPath, store);
    const base = JSON.parse(baseJson) as SharedIndex;

    const allAnnotations = await this.listAnnotations();
    const projectSymbolIds = new Set(base.symbols.map(s => s.id));
    const relevantAnnotations = allAnnotations.filter(a =>
      projectSymbolIds.has(a.symbol_id),
    );

    const shared: SharedIndex = {
      ...base,
      annotations: relevantAnnotations,
    };

    return JSON.stringify(shared, null, 2);
  }

  // ---- 内部辅助 ----

  private ensureAnnotationsDir(): void {
    const dir = join(this.annotationsPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private loadAnnotations(): AnnotationsFile {
    if (!existsSync(this.annotationsPath)) {
      return { version: '1.0', annotations: [] };
    }
    try {
      const raw = readFileSync(this.annotationsPath, 'utf-8');
      const data = JSON.parse(raw) as AnnotationsFile;
      if (!data.annotations || !Array.isArray(data.annotations)) {
        return { version: '1.0', annotations: [] };
      }
      return data;
    } catch (err) {
      throw new CollabError(
        CollabError.STORE_FAILED,
        `读取注释文件失败: ${this.annotationsPath}`,
        { cause: err },
      );
    }
  }

  private saveAnnotations(data: AnnotationsFile): void {
    try {
      writeFileSync(this.annotationsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      throw new CollabError(
        CollabError.STORE_FAILED,
        `写入注释文件失败: ${this.annotationsPath}`,
        { cause: err },
      );
    }
  }

  private filterProjectSymbols(symbols: Symbol[], projectPath: string): Symbol[] {
    const prefix = projectPath.endsWith('/') ? projectPath : `${projectPath}/`;
    return symbols.filter(s => s.location.file_path.startsWith(prefix));
  }

  private filterProjectReferences(refs: Reference[], projectPath: string): Reference[] {
    const prefix = projectPath.endsWith('/') ? projectPath : `${projectPath}/`;
    return refs.filter(r => r.location.file_path.startsWith(prefix));
  }
}
