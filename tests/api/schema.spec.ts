import { test, expect } from '@playwright/test';

test.describe('Schema API', () => {
  test('GET /api/schema/tables returns array with at least one table', async ({ request }) => {
    const resp = await request.get('/api/schema/tables', {});
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body.tables)).toBe(true);
    expect(body.tables.length).toBeGreaterThan(0);
  });

  test('POST /api/schema/tables with valid SQL returns valid:true', async ({ request }) => {
    const resp = await request.post('/api/schema/tables', {
      data: { queries: ['SELECT COUNT(*) FROM events'] },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.valid).toBe(true);
    expect(body.errors.length).toBe(0);
  });

  test('POST /api/schema/tables with invalid SQL returns valid:false', async ({ request }) => {
    const resp = await request.post('/api/schema/tables', {
      data: { queries: ['SELECT * FROM nonexistent_xyz_table'] },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});
