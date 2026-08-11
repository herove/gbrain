import { afterEach, describe, expect, test } from 'bun:test';
import {
  __setChatTransportForTests,
  resetGateway,
  type ChatResult,
} from '../src/core/ai/gateway.ts';
import { extractFactsFromTurnWithOutcome } from '../src/core/facts/extract.ts';

afterEach(() => {
  __setChatTransportForTests(null);
  resetGateway();
});

function response(text: string, stopReason: ChatResult['stopReason'] = 'end'): ChatResult {
  return {
    text,
    blocks: [],
    stopReason,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    },
    model: 'test:stub',
    providerId: 'test',
  };
}

async function extract() {
  return extractFactsFromTurnWithOutcome({
    turnText: 'The migration completed.',
    source: 'test:malformed-retry',
  });
}

describe('facts extractor malformed-output retry', () => {
  test('retries malformed JSON once and recovers', async () => {
    let calls = 0;
    __setChatTransportForTests(async () => {
      calls++;
      return calls === 1
        ? response('{not-json')
        : response(JSON.stringify({ facts: [{ fact: 'Migration completed', kind: 'event' }] }));
    });

    const outcome = await extract();
    expect(calls).toBe(2);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.facts[0]!.fact).toBe('Migration completed');
  });

  test('retries an all-invalid candidate array once', async () => {
    let calls = 0;
    __setChatTransportForTests(async () => {
      calls++;
      return calls === 1
        ? response(JSON.stringify({ facts: [{ fact: 'Missing kind', kind: null }] }))
        : response(JSON.stringify({ facts: [] }));
    });

    expect(await extract()).toEqual({ ok: true, facts: [] });
    expect(calls).toBe(2);
  });

  test('stops after the second malformed response', async () => {
    let calls = 0;
    __setChatTransportForTests(async () => {
      calls++;
      return response('{still-not-json');
    });

    expect(await extract()).toEqual({ ok: false, reason: 'malformed_output' });
    expect(calls).toBe(2);
  });

  test('does not retry when at least one valid candidate can be salvaged', async () => {
    let calls = 0;
    __setChatTransportForTests(async () => {
      calls++;
      return response(JSON.stringify({
        facts: [
          { fact: 'Valid fact', kind: 'fact' },
          { fact: 'Invalid candidate', kind: null },
        ],
      }));
    });

    const outcome = await extract();
    expect(calls).toBe(1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.facts).toHaveLength(1);
  });
});
