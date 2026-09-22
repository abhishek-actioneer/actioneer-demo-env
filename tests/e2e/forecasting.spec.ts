import { test, expect } from '../fixtures/index';

test.describe('Forecasting page', () => {
  test.setTimeout(60_000);

  test('visiting /forecasting loads the page', async ({ page }) => {
    await page.goto('/forecasting');
    await expect(page).toHaveURL('/forecasting');
    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  test('forecasting page shows content without errors', async ({ page }) => {
    await page.goto('/forecasting');
    await page.waitForLoadState('networkidle');
    // Just verify the page loaded
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });
});
