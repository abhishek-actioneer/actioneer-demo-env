import { test, expect } from '@playwright/test';

test.describe('Recommend API', () => {
  test.setTimeout(60_000);

  test('POST /api/recommend returns actions array', async ({ request }) => {
    const resp = await request.post('/api/recommend', {
      data: {
        query: 'what is the revenue breakdown by brand?',
        responseText: 'Samsung leads with 40% of revenue, followed by Apple at 25%.',
        mode: 'quick',
      },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('actions');
    expect(Array.isArray(body.actions)).toBe(true);
  });
});
