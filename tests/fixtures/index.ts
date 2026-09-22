import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { test as base } from '@playwright/test';

/**
 * Extended test fixture that sets up Clerk testing token for each test.
 * Browser-context tests also inherit storageState from playwright config.
 */
export const test = base.extend<object>({
  page: async ({ page }, use) => {
    await setupClerkTestingToken({ page });
    await use(page);
  },
});

export { expect } from '@playwright/test';
