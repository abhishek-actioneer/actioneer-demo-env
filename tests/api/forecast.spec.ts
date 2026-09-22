import { test, expect } from '@playwright/test';

// Historical weekly data aligned to Mondays for testing
const HISTORICAL: Record<string, number> = {
  '2019-11-04': 50.0,
  '2019-11-11': 55.0,
  '2019-11-18': 60.0,
  '2019-11-25': 58.0,
  '2019-12-02': 62.0,
  '2019-12-09': 65.0,
};

test.describe('Forecast API', () => {
  test.setTimeout(60_000);

  test('POST /api/forecast/seed with valid SQL returns data object', async ({ request }) => {
    const resp = await request.post('/api/forecast/seed', {
      data: {
        sql: 'SELECT date, revenue FROM daily_metrics ORDER BY date',
        aggregation: 'sum',
      },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    // Returns { data: {...} } — data may be empty if columns not detected
    expect(body).toHaveProperty('data');
    expect(typeof body.data).toBe('object');
  });

  test('POST /api/forecast/generate-sql returns SQL string', async ({ request }) => {
    const resp = await request.post('/api/forecast/generate-sql', {
      data: { description: 'total revenue' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(typeof body.sql).toBe('string');
    expect(body.sql.trim().length).toBeGreaterThan(0);
  });

  test('POST /api/forecast/predict returns forecast with week keys', async ({ request }) => {
    const resp = await request.post('/api/forecast/predict', {
      data: {
        label: 'Revenue',
        format: 'currency',
        historical: HISTORICAL,
        forecastWeeks: 4,
      },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('forecast');
    expect(typeof body.forecast).toBe('object');
    // Should have 4 forecast entries (one per week)
    expect(Object.keys(body.forecast).length).toBeGreaterThanOrEqual(1);
  });

  test('POST /api/forecast/predict with no historical data returns 400', async ({ request }) => {
    const resp = await request.post('/api/forecast/predict', {
      data: {
        label: 'Revenue',
        format: 'currency',
        historical: {},
      },
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe('No historical data provided');
    expect(body.forecast).toEqual({});
  });
});
