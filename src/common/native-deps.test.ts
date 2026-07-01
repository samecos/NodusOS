import { describe, it, expect } from 'vitest';

const NATIVE_PACKAGES = [
  'better-sqlite3',
  'tree-sitter',
  'tree-sitter-typescript',
  'tree-sitter-javascript',
  'tree-sitter-python',
];

describe('Native dependency loading', () => {
  NATIVE_PACKAGES.forEach((name, index) => {
    it(`TC-UT-ND-${String(index + 1).padStart(3, '0')}: should load ${name}`, async () => {
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
  });
});
