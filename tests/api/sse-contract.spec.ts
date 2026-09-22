import { test, expect } from '@playwright/test';

/**
 * Smoke test for the SSE streaming contract.
 * Verifies that /api/analyze emits valid NDJSON events
 * matching the AnalyzeSSEEvent type from sse-types.ts.
 */

const VALID_EVENT_TYPES = new Set([
  'ack', 'plan', 'phase', 'sql', 'query_result',
  'summary', 'result', 'text', 'report',
  'recommendations', 'done', 'error',
]);

function parseNDJSON(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
}

test.describe('SSE contract validation', () => {
  test.setTimeout(120_000);

  test('all emitted events have a valid type field', async ({ request }) => {
    const resp = await request.post('/api/analyze', {
      data: { query: 'count all events', mode: 'quick' },
    });
    expect(resp.status()).toBe(200);
    const events = parseNDJSON(await resp.text());
    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(VALID_EVENT_TYPES).toContain(event.type);
    }
  });

  test('sql events have required fields', async ({ request }) => {
    const resp = await request.post('/api/analyze', {
      data: { query: 'total number of users', mode: 'quick' },
    });
    const events = parseNDJSON(await resp.text());
    const sqlEvents = events.filter((e) => e.type === 'sql');

    for (const event of sqlEvents) {
      expect(typeof event.subagentId).toBe('string');
      expect(Array.isArray(event.queries)).toBe(true);
      const queries = event.queries as Array<{ sql: string; description: string; queryIndex: number }>;
      for (const q of queries) {
        expect(typeof q.sql).toBe('string');
        expect(typeof q.description).toBe('string');
        expect(typeof q.queryIndex).toBe('number');
      }
    }
  });

  test('stream ends with done event (no dangling connections)', async ({ request }) => {
    const resp = await request.post('/api/analyze', {
      data: { query: 'how many events yesterday', mode: 'quick' },
    });
    const events = parseNDJSON(await resp.text());
    const types = events.map((e) => e.type);
    expect(types).toContain('done');
    expect(types).not.toContain('error');
  });
});
