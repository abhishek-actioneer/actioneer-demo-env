import { test, expect } from '@playwright/test';

function parseNDJSON(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
}

test.describe('POST /api/analyze', () => {
  test.setTimeout(120_000);

  test('quick mode emits required event types', async ({ request }) => {
    const resp = await request.post('/api/analyze', {
      data: { query: 'how many total events are in the dataset?', mode: 'quick' },
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    const events = parseNDJSON(text);
    const types = events.map((e) => e.type as string);

    expect(types).toContain('phase');
    expect(types).toContain('sql');
    expect(types).toContain('query_result');
    expect(types).toContain('text');
    expect(types).toContain('done');
    expect(types).not.toContain('error');
  });

  test('deep mode emits summary events in addition to quick events', async ({ request }) => {
    const resp = await request.post('/api/analyze', {
      data: { query: 'what is the breakdown of event types?', mode: 'deep' },
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    const events = parseNDJSON(text);
    const types = events.map((e) => e.type as string);

    expect(types).toContain('phase');
    expect(types).toContain('sql');
    expect(types).toContain('done');
    // Deep mode should have more events than quick mode
    expect(events.length).toBeGreaterThan(3);
  });
});
