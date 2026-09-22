import { test, expect } from '@playwright/test';

test.describe('Knowledge API', () => {
  test.setTimeout(60_000);

  test('POST /api/knowledge/add returns entry with category', async ({ request }) => {
    const resp = await request.post('/api/knowledge/add', {
      data: {
        content: 'Our top customers are enterprise accounts with >$10k monthly spend',
        priority: 'High',
        level: 'global',
      },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('entry');
    expect(body.entry).toHaveProperty('category');
    expect(typeof body.entry.category).toBe('string');
  });

  test('POST /api/knowledge/parse returns entries array', async ({ request }) => {
    const resp = await request.post('/api/knowledge/parse', {
      data: { text: 'Revenue is the total purchase price. Users who churned have not purchased in 30 days.' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);
  });
});
