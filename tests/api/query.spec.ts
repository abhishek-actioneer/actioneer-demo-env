import { test, expect } from '@playwright/test';

test.describe('POST /api/query', () => {
  test('valid SELECT returns columns and rows', async ({ request }) => {
    const resp = await request.post('/api/query', {
      data: { sql: 'SELECT COUNT(*) as total FROM events' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body.columns)).toBe(true);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.rowCount).toBe('number');
  });

  test('non-SELECT statement returns 400', async ({ request }) => {
    const resp = await request.post('/api/query', {
      data: { sql: 'INSERT INTO events VALUES (1)' },
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toBeTruthy();
  });

  test('DDL keyword returns 400', async ({ request }) => {
    const resp = await request.post('/api/query', {
      data: { sql: 'DROP TABLE events' },
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toBeTruthy();
  });

  test('query without LIMIT is capped at 500 rows', async ({ request }) => {
    const resp = await request.post('/api/query', {
      data: { sql: 'SELECT * FROM events' },
    });
    await expect(resp).toBeOK();
    const body = await resp.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows.length).toBeLessThanOrEqual(500);
  });

  test('invalid SQL returns 400', async ({ request }) => {
    const resp = await request.post('/api/query', {
      data: { sql: 'SELECT * FROM nonexistent_table_xyz_abc' },
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toBeTruthy();
  });

  test('missing sql field returns 400', async ({ request }) => {
    const resp = await request.post('/api/query', {
      data: {},
    });
    expect(resp.status()).toBe(400);
  });
});
