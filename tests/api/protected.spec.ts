import { test, expect } from '@playwright/test';

const PROTECTED_ROUTES = [
  { method: 'GET' as const, path: '/api/segments' },
  { method: 'GET' as const, path: '/api/datasets' },
  { method: 'GET' as const, path: '/api/integrations' },
  { method: 'GET' as const, path: '/api/schema/tables' },
];

test.describe('Auth protection (Clerk)', () => {
  // Authenticated tests — storageState is injected by playwright config
  for (const route of PROTECTED_ROUTES) {
    test(`${route.method} ${route.path} succeeds with Clerk session`, async ({ request }) => {
      const resp = await request.fetch(route.path, { method: route.method });
      expect(resp.status()).toBeLessThan(400);
    });
  }
});
