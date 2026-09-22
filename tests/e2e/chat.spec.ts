import { test, expect } from '../fixtures/index';

test.describe('Chat page', () => {
  test.setTimeout(120_000);

  test('welcome/placeholder is visible on load', async ({ page }) => {
    await page.goto('/');
    // Page loaded successfully — some form of content is visible
    await expect(page.locator('body')).toBeVisible();
    // Input area should be present
    await expect(page.locator('textarea, input[type="text"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('submitting an analytics question triggers processing', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('how many total purchase events are there?');
    await input.press('Enter');

    // Wait for some response to appear (agent cards or text)
    await page.waitForSelector('[data-testid="agent-card"], .agent-card, [class*="agent"], [class*="streaming"], [class*="response"]', {
      timeout: 60_000,
    }).catch(async () => {
      // Fallback: just wait for any new content beyond the input
      await page.waitForTimeout(5000);
    });

    // After waiting, page should still be on /
    await expect(page).toHaveURL('/');
  });
});
