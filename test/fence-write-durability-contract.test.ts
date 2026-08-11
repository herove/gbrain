import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/core/facts/fence-write.ts', import.meta.url),
  'utf8',
);

describe('facts fence Git durability contract', () => {
  test('commits only the written fence after the DB insert succeeds', () => {
    const insertAt = source.indexOf('engine.insertFacts(enriched');
    const commitAt = source.indexOf('await commitFactFenceDurably(', insertAt);

    expect(source).toContain('factFenceGitPathState(durabilityRepoPath, filePath)');
    expect(source).toContain('commitWriteThroughExpectedContent(');
    expect(source).toContain('expectedContent');
    expect(source).toContain('git_durability_preexisting_dirty');
    expect(insertAt).toBeGreaterThan(-1);
    expect(commitAt).toBeGreaterThan(insertAt);
  });
});
