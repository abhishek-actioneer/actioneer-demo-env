import { test, expect } from '../fixtures/index';

test.describe('Metrics page', () => {
  test('visiting /metrics loads the metrics list', async ({ page }) => {
    await page.goto('/metrics');
    await expect(page).toHaveURL('/metrics');
    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  test('metrics page shows some content', async ({ page }) => {
    await page.goto('/metrics');
    await page.waitForLoadState('networkidle');
    // Page should have rendered without errors
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(10);
  });
});
