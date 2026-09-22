import { test, expect } from '@playwright/test';

const TEST_SQL = "SELECT DISTINCT user_id FROM events WHERE event_type = 'purchase'";

test.describe.serial('Segments API', () => {
  let segmentId: string;
  const segmentName = `test-segment-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    // Clean up any leftover test segments
    const resp = await request.get('/api/segments', {});
    if (resp.ok()) {
      const segments = await resp.json();
      for (const seg of segments) {
        if (seg.name?.startsWith('test-')) {
          await request.delete(`/api/segments/${seg.id}`, {});
        }
      }
    }
  });

  test('POST /api/segments creates segment', async ({ request }) => {
    const resp = await request.post('/api/segments', {
      data: { name: segmentName, sql: TEST_SQL },
    });
    expect(resp.status()).toBe(201);
    const body = await resp.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe(segmentName);
    segmentId = body.id;
  });

  test('GET /api/segments returns array containing created segment', async ({ request }) => {
    const resp = await request.get('/api/segments', {});
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((s: { id: string }) => s.id === segmentId);
    expect(found).toBeTruthy();
  });

  test('GET /api/segments/:id returns segment with preview', async ({ request }) => {
    const resp = await request.get(`/api/segments/${segmentId}`, {});
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.id).toBe(segmentId);
    expect(typeof body.userCount).toBe('number');
    expect(Array.isArray(body.preview)).toBe(true);
  });

  test('PATCH /api/segments/:id updates name', async ({ request }) => {
    const updatedName = `test-updated-${Date.now()}`;
    const resp = await request.patch(`/api/segments/${segmentId}`, {
      data: { name: updatedName },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
  });

  test('DELETE /api/segments/:id removes segment', async ({ request }) => {
    const resp = await request.delete(`/api/segments/${segmentId}`, {});
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);

    // Verify 404 on subsequent GET
    const getResp = await request.get(`/api/segments/${segmentId}`, {});
    expect(getResp.status()).toBe(404);
  });

  test('POST /api/segments/generate-sql returns SQL string', async ({ request }) => {
    test.setTimeout(60_000);
    const resp = await request.post('/api/segments/generate-sql', {
      data: { description: 'users who made a purchase' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(typeof body.sql).toBe('string');
    expect(body.sql.trim().length).toBeGreaterThan(0);
  });
});

test.describe.serial('Segments dataset isolation', () => {
  let segmentId: string;

  test('segment created with x-dataset-id is isolated to that dataset', async ({ request }) => {
    // Create segment with explicit dataset header
    const createResp = await request.post('/api/segments', {
      headers: { 'x-dataset-id': 'ecommerce' },
      data: { name: `test-isolation-${Date.now()}`, sql: TEST_SQL },
    });
    expect(createResp.status()).toBe(201);
    segmentId = (await createResp.json()).id;

    // Should appear when fetching with same dataset
    const sameResp = await request.get('/api/segments', {
      headers: { 'x-dataset-id': 'ecommerce' },
    });
    expect(sameResp.status()).toBe(200);
    const sameBody = await sameResp.json();
    expect(sameBody.find((s: { id: string }) => s.id === segmentId)).toBeTruthy();

    // Should NOT appear when fetching with different dataset
    const diffResp = await request.get('/api/segments', {
      headers: { 'x-dataset-id': 'nonexistent-dataset' },
    });
    expect(diffResp.status()).toBe(200);
    const diffBody = await diffResp.json();
    expect(diffBody.find((s: { id: string }) => s.id === segmentId)).toBeFalsy();

    // Cleanup
    await request.delete(`/api/segments/${segmentId}`, {});
  });
});
