import { test, expect } from '@playwright/test';

test.describe('Datasets API', () => {
  test('GET /api/datasets returns array with ecommerce dataset', async ({ request }) => {
    const resp = await request.get('/api/datasets');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
    const ecommerce = body.find((d: { id: string }) => d.id === 'ecommerce');
    expect(ecommerce).toBeTruthy();
  });

  test('GET /api/datasets/ecommerce/prompts returns suggestedPrompts array', async ({ request }) => {
    const resp = await request.get('/api/datasets/ecommerce/prompts');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body.suggestedPrompts)).toBe(true);
    expect(typeof body.welcomeSubtitle).toBe('string');
    if (body.suggestedPrompts.length > 0) {
      expect(typeof body.suggestedPrompts[0]).toBe('string');
    }
  });

  test('GET /api/datasets/ecommerce/enrich responds (200 with schema or 404 if not enriched)', async ({ request }) => {
    const resp = await request.get('/api/datasets/ecommerce/enrich');
    // Static datasets may not have a stored schemaMap → 404 is valid
    expect([200, 404]).toContain(resp.status());
    const body = await resp.json();
    expect(body).toBeTruthy();
  });
});
