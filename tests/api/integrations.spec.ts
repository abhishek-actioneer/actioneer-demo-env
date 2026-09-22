import { test, expect } from '@playwright/test';

test.describe('Integrations API', () => {
  test('GET /api/integrations returns array of integration objects', async ({ request }) => {
    const resp = await request.get('/api/integrations', {});
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      const first = body[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name');
      expect(typeof first.connected).toBe('boolean');
    }
  });

  test('PATCH /api/integrations toggles connected state', async ({ request }) => {
    // Connect
    const connectResp = await request.patch('/api/integrations', {
      data: { id: 'klaviyo', connected: true },
    });
    expect(connectResp.status()).toBe(200);
    const connectBody = await connectResp.json();
    expect(connectBody.success).toBe(true);

    // Disconnect
    const disconnectResp = await request.patch('/api/integrations', {
      data: { id: 'klaviyo', connected: false },
    });
    expect(disconnectResp.status()).toBe(200);

    // Verify GET reflects disconnected state
    const listResp = await request.get('/api/integrations', {});
    const list = await listResp.json();
    const klaviyo = list.find((i: { id: string }) => i.id === 'klaviyo');
    if (klaviyo) {
      expect(klaviyo.connected).toBe(false);
    }
  });
});
