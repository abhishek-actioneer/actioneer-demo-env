import { test, expect } from '../fixtures/index';

test.describe.serial('Segments page', () => {
  test.setTimeout(60_000);

  test.beforeAll(async ({ request }) => {
    // Clean up test segments
    const resp = await request.get('/api/segments');
    if (resp.ok()) {
      const segments = await resp.json();
      for (const seg of segments) {
        if (seg.name?.startsWith('test-')) {
          await request.delete(`/api/segments/${seg.id}`);
        }
      }
    }
  });

  test('visiting /segments loads the segments list', async ({ page }) => {
    await page.goto('/segments');
    await expect(page).toHaveURL('/segments');
    await expect(page.locator('body')).toBeVisible();
    // Wait for page content to load
    await page.waitForLoadState('networkidle');
  });

  test('can open segment builder and dismiss it', async ({ page }) => {
    await page.goto('/segments');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: 'New Segment' }).first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    await expect(page.getByPlaceholder('Untitled segment')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Build a new segment by picking events from the panel on the right.')).toBeVisible();
    await expect(page.getByText('Describe your audience')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add Rule' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByPlaceholder('Untitled segment')).not.toBeVisible({ timeout: 5_000 });
  });
});
