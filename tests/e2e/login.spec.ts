import { test, expect } from '@playwright/test';

test.describe('Auth flow (Clerk)', () => {
  test('authenticated user can access /', async ({ page }) => {
    // storageState from auth.setup.ts provides Clerk session
    await page.goto('/');
    await expect(page).toHaveURL('/');
  });

  test('/sign-in page renders Clerk sign-in', async ({ page }) => {
    await page.goto('/sign-in');
    // Clerk's sign-in component should be present
    await expect(page.locator('[data-clerk-component]')).toBeVisible({ timeout: 10_000 });
  });
});
