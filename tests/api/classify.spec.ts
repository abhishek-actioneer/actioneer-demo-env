import { test, expect } from '@playwright/test';

test.describe('POST /api/classify', () => {
  test('analytics-sounding question returns analytics or direct type', async ({ request }) => {
    const resp = await request.post('/api/classify', {
      data: { query: 'what is the total revenue?' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(['analytics', 'direct']).toContain(body.mode);
  });

  test('simple greeting returns direct type', async ({ request }) => {
    const resp = await request.post('/api/classify', {
      data: { query: 'hello' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(['analytics', 'direct']).toContain(body.mode);
  });

  test('missing message returns 400', async ({ request }) => {
    const resp = await request.post('/api/classify', {
      data: {},
    });
    expect(resp.status()).toBe(400);
  });

  test('voice agent creation uses the dedicated generation intent', async ({ request }) => {
    const resp = await request.post('/api/classify', {
      data: { query: 'Create a voice agent to welcome the Active Members segment' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.mode).toBe('voice_agent_generation');
  });
});
