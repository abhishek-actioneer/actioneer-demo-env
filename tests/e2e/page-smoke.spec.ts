import { test, expect } from '@playwright/test';

// User-journey smoke test: visit every top-level route like a real user and
// assert the page renders without an uncaught runtime exception or the Next.js
// error overlay. This is the net that catches crashes such as the
// research-timeline `subagent.queries` throw.
const ROUTES = [
  '/',
  '/metrics',
  '/metric-tree',
  '/playbooks',
  '/scouts',
  '/segments',
  '/voice-campaigns',
  '/knowledge',
  '/funnels',
  '/retentions',
  '/canvas',
  '/connectors',
  '/data-catalog',
  '/explore',
  '/billing',
  '/ad-creative',
  '/store',
  '/store/offers',
  '/store/players',
  '/store/catalog',
  '/store/transactions',
  '/campaigns',
];

test.describe('Page smoke (no crash)', () => {
  // Returning-user state: the one-time welcome modal is already dismissed.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sentinel-welcome-shown', '1');
      } catch {
        /* ignore */
      }
    });
  });

  for (const route of ROUTES) {
    test(`${route} renders without a runtime crash`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.goto(route, { waitUntil: 'domcontentloaded' });
      // Should not have been bounced to auth.
      await expect(page).not.toHaveURL(/\/auth/);
      // Give client components a moment to mount and (potentially) throw.
      await page.waitForTimeout(1500);

      // No Next.js error dialog. (Note: the bare <nextjs-portal> host element
      // is always present in dev, so we target the error dialog specifically —
      // it only mounts when there's a build/runtime error.)
      const errorDialog = page.locator('[data-nextjs-dialog-overlay], [data-nextjs-dialog]');
      await expect(errorDialog).toHaveCount(0);

      // Primary crash signal: an uncaught runtime exception (e.g. the
      // research-timeline `subagent.queries` throw).
      expect(pageErrors, `uncaught exceptions on ${route}`).toEqual([]);
    });
  }
});
