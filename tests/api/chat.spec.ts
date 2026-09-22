import { test, expect } from '@playwright/test';

test.describe('POST /api/chat', () => {
  test.setTimeout(60_000);

  test('returns non-empty streaming text response', async ({ request }) => {
    const resp = await request.post('/api/chat', {
      data: { query: 'Hello, what can you help me with?' },
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    expect(text.trim().length).toBeGreaterThan(0);
  });
});
