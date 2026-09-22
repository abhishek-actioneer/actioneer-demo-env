import { test, expect } from '@playwright/test';

// Auth is handled via storageState in playwright.config.ts (Clerk session)

const PAGES = [
  { path: '/metrics', name: 'metrics-list-v1' },
  { path: '/segments', name: 'segments-list-v1' },
  { path: '/forecasting', name: 'forecasting-dashboard-v1' },
  { path: '/playbooks', name: 'playbooks-list-v1' },
  { path: '/data-catalog', name: 'data-catalog-v1' },
  { path: '/connectors', name: 'connectors-v1' },
  { path: '/knowledge', name: 'knowledge-v1' },
];

test.describe('Visual regression', () => {
  for (const { path, name } of PAGES) {
    test(`${path} matches snapshot`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot(`${name}.png`, {
        maxDiffPixelRatio: 0.02,
      });
    });
  }

  test('sidebar all items visible', async ({ page }) => {
    await page.goto('/metrics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await expect(sidebar).toHaveScreenshot('sidebar-all-items-v1.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('sidebar active state on metrics', async ({ page }) => {
    await page.goto('/metrics');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await expect(sidebar).toHaveScreenshot('sidebar-metrics-active-v1.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
