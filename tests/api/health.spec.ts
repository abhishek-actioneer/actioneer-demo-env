import { test, expect } from '@playwright/test';

test.describe('GET /api/health', () => {
  test('returns 200 without auth', async ({ request }) => {
    const resp = await request.get('/api/health');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(typeof body.dbReady).toBe('boolean');
  });

  test('accepts datasetId query param', async ({ request }) => {
    const resp = await request.get('/api/health?datasetId=ecommerce');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.dbReady).toBe(true);
  });
});
