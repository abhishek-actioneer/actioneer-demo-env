import { test, expect } from '@playwright/test';

test.describe('Auth (Clerk)', () => {
  test('unauthenticated request to protected route returns 401 or redirect', async ({ request }) => {
    // Create a fresh context without storageState to test unauthenticated access
    const resp = await request.fetch('/api/segments', {
      maxRedirects: 0,
    });
    // Clerk middleware either returns 401 for API routes or 307 redirect
    expect([307, 401]).toContain(resp.status());
  });

  test('GET /api/health is public (no auth required)', async ({ request }) => {
    const resp = await request.get('/api/health');
    expect(resp.status()).toBe(200);
  });
});
