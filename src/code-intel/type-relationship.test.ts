import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteKnowledgeStore } from '../store/knowledge-store.impl.js';
import { CodeIntelligenceImpl } from './code-intelligence.impl.js';
import type { KnowledgeStore } from '../store/knowledge-store.js';
import type { CodeIntelligence } from './code-intelligence.js';

const source = `
export interface IUserService {
  getUser(id: string): void;
}

export class UserService implements IUserService {
  getUser(id: string): void {}
}

export class AdminService implements IUserService {
  getUser(id: string): void {}
}

export class Base {}
export class Derived extends Base {}

export function process(service: IUserService): void {}
`;

describe('TypeRelationship queries', () => {
  let store: KnowledgeStore;
  let ci: CodeIntelligence;

  beforeEach(async () => {
    store = new SqliteKnowledgeStore(':memory:');
    ci = new CodeIntelligenceImpl(store);
    const parser = new (await import('./parsers/typescript-parser.js')).TypeScriptParser();
    const symbols = parser.parseSymbols(source, '/tmp/service.ts');
    const refs = parser.parseReferences(source, symbols);
    store.symbolsUpsert(symbols);
    store.refsUpsert(refs);
  });

  it('TC-UT-TR-001: findImplementations returns classes implementing interface', async () => {
    const iface = store.symbolsFindByName('IUserService', 'interface', 1)[0]!;
    const impls = await ci.findImplementations(iface.id);
    expect(impls.map(s => s.name)).toContain('UserService');
    expect(impls.map(s => s.name)).toContain('AdminService');
  });

  it('TC-UT-TR-002: findSubclasses returns derived classes', async () => {
    const base = store.symbolsFindByName('Base', 'class', 1)[0]!;
    const subs = await ci.findSubclasses(base.id);
    expect(subs.map(s => s.name)).toContain('Derived');
  });

  it('TC-UT-TR-003: findTypeUses returns symbols that use the type', async () => {
    const iface = store.symbolsFindByName('IUserService', 'interface', 1)[0]!;
    const users = await ci.findTypeUses(iface.id);
    expect(users.map(s => s.name)).toContain('process');
  });
});
