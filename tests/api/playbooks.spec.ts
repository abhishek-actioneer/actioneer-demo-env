import { test, expect } from '@playwright/test';
import { parseNDJSON } from '../fixtures/ndjson';

const MINIMAL_PLAYBOOK = {
  name: 'Test Playbook',
  description: 'A minimal test playbook',
  cells: [
    {
      id: 'c1',
      type: 'sql',
      role: 'guardrail',
      label: 'Check data',
      description: 'Count events',
      dependsOn: [],
      outputs: ['total'],
      sql: 'SELECT COUNT(*) as total FROM events',
    },
  ],
};

test.describe('Playbooks API', () => {
  test('POST /api/playbook/create streams NDJSON with required events', async ({ request }) => {
    test.setTimeout(120_000);
    const resp = await request.post('/api/playbook/create', {
      data: { query: 'analyze purchase patterns', proceedWithout: true },
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    const events = parseNDJSON(text);
    const types = events.map((e) => e.type as string);

    expect(types).toContain('done');
    // Should have either outline_cell (two-phase) or cell (legacy single-phase)
    const hasCells = types.includes('outline_cell') || types.includes('cell');
    expect(hasCells).toBe(true);
  });

  test('POST /api/playbook/intent returns ops array', async ({ request }) => {
    test.setTimeout(60_000);
    const resp = await request.post('/api/playbook/intent', {
      data: {
        playbook: MINIMAL_PLAYBOOK,
        annotations: [{ text: 'add a revenue breakdown query', cellId: null }],
      },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body.ops)).toBe(true);
  });

  test('POST /api/playbook/validate with valid SQL returns valid:true', async ({ request }) => {
    const resp = await request.post('/api/playbook/validate', {
      data: { cells: [MINIMAL_PLAYBOOK.cells[0]] },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.valid).toBe(true);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.every((r: { valid: boolean }) => r.valid)).toBe(true);
  });

  test('POST /api/playbook/validate with invalid SQL returns valid:false', async ({ request }) => {
    const resp = await request.post('/api/playbook/validate', {
      data: {
        cells: [
          {
            id: 'c1',
            type: 'sql',
            sql: 'SELECT * FROM this_table_does_not_exist_xyz',
          },
        ],
      },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.valid).toBe(false);
    expect(body.results.some((r: { valid: boolean }) => !r.valid)).toBe(true);
  });

  test('POST /api/playbook/run streams with required events', async ({ request }) => {
    test.setTimeout(120_000);
    const resp = await request.post('/api/playbook/run', {
      data: { playbook: MINIMAL_PLAYBOOK },
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    const events = parseNDJSON(text);
    const types = events.map((e) => e.type as string);
    expect(types).toContain('done');
  });

  test('POST /api/playbook/edit streams with cell_detail or done', async ({ request }) => {
    test.setTimeout(120_000);
    const resp = await request.post('/api/playbook/edit', {
      data: {
        playbook: MINIMAL_PLAYBOOK,
        annotations: [{ text: 'add a LIMIT 5', cellId: 'c1' }],
      },
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    const events = parseNDJSON(text);
    expect(events.length).toBeGreaterThan(0);
    const types = events.map((e) => e.type as string);
    expect(types).toContain('done');
  });
});
