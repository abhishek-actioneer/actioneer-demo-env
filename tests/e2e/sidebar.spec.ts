import { test, expect } from '../fixtures/index';

// Only test nav items that are always enabled (not gated by feature flags).
// Connectors, Scouts, Store etc. may be disabled via NEXT_PUBLIC_DISABLED_FEATURES.
const NAV_ITEMS = [
  { label: 'Metrics', path: '/metrics' },
  { label: 'Segments', path: '/segments' },
  { label: 'Playbooks', path: '/playbooks' },
];

test.describe('Sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Dismiss the Next.js dev overlay if present — it intercepts pointer events
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document.querySelectorAll('nextjs-portal').forEach(el => el.remove());
    });
  });

  for (const item of NAV_ITEMS) {
    test(`clicking ${item.label} navigates to ${item.path}`, async ({ page }) => {
      // Top-level nav items render as <Link> (an <a>), not <button>.
      const navLink = page.getByRole('link', { name: item.label, exact: true }).first();
      await expect(navLink).toBeVisible({ timeout: 10_000 });
      await navLink.click();
      await expect(page).toHaveURL(item.path, { timeout: 10_000 });
    });
  }

  test('Account panel opens on hover', async ({ page }) => {
    const rail = page.locator('aside > div').first();
    const accountTrigger = rail.locator('button').last();
    await expect(accountTrigger).toBeVisible({ timeout: 10_000 });
    await accountTrigger.hover();
    const accountHeading = page.locator('aside h3').filter({ hasText: 'Account' });
    await expect(accountHeading).toBeVisible({ timeout: 5_000 });
  });
});
