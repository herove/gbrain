import { describe, expect, test } from 'bun:test';
import type { BrainEngine } from '../src/core/engine.ts';
import { loadImportSourcePolicy } from '../src/core/import-file.ts';

describe('loadImportSourcePolicy', () => {
  test('uses the selected source contextual-retrieval policy', async () => {
    const calls: unknown[][] = [];
    const engine = {
      executeRaw: async (_sql: string, params?: unknown[]) => {
        calls.push(params ?? []);
        return [{
          id: 'receipts',
          contextual_retrieval_mode: 'none',
          trust_frontmatter_overrides: true,
        }];
      },
    } as unknown as BrainEngine;

    await expect(loadImportSourcePolicy(engine, 'receipts')).resolves.toEqual({
      id: 'receipts',
      contextual_retrieval_mode: 'none',
      trust_frontmatter_overrides: true,
    });
    expect(calls).toEqual([['receipts']]);
  });

  test('fails closed when the source lookup is unavailable', async () => {
    const engine = {
      executeRaw: async () => { throw new Error('old engine'); },
    } as unknown as BrainEngine;
    await expect(loadImportSourcePolicy(engine, 'legacy')).resolves.toEqual({
      id: 'legacy',
      contextual_retrieval_mode: null,
      trust_frontmatter_overrides: false,
    });
  });
});
