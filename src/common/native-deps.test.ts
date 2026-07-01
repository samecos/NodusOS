import { describe, it, expect } from 'vitest';

const NATIVE_PACKAGES = [
  'better-sqlite3',
  'tree-sitter',
  'tree-sitter-typescript',
  'tree-sitter-javascript',
  'tree-sitter-python',
];

describe('Native dependency loading', () => {
  for (const name of NATIVE_PACKAGES) {
    it(`TC-UT-ND-001: should load ${name}`, async () => {
      let mod: unknown;
      try {
        mod = await import(name);
      } catch (err) {
        throw new Error(
          `Failed to load native dependency "${name}". ` +
          `Run "npm run rebuild:native" and try again. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      expect(mod).toBeDefined();
    });
  }
});
