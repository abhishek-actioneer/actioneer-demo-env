import { test, expect } from '@playwright/test';

// User-journey coverage: clicking a top-level sidebar nav item must open that
// page. Regression guard for the "Funnels / Retentions don't open" bug.
const NAV: { label: string; path: string }[] = [
  { label: 'Metrics', path: '/metrics' },
  { label: 'Playbooks', path: '/playbooks' },
  { label: 'Segments', path: '/segments' },
  { label: 'Funnels', path: '/funnels' },
  { label: 'Retentions', path: '/retentions' },
  { label: 'Knowledge', path: '/knowledge' },
];

test.describe('Sidebar navigation', () => {
  // Behave like a returning user: the one-time welcome modal is already
  // dismissed, so it doesn't sit over the sidebar intercepting clicks.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sentinel-welcome-shown', '1');
      } catch {
        /* ignore */
      }
    });
  });

  for (const { label, path } of NAV) {
    test(`clicking "${label}" opens ${path}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await page.goto('/');
      const link = page.getByRole('link', { name: label, exact: true }).first();
      await expect(link).toBeVisible();
      await link.click();

      await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}(\\/|$|\\?)`), {
        timeout: 10_000,
      });
      expect(consoleErrors, `console errors after opening ${path}`).toEqual([]);
    });
  }
});
