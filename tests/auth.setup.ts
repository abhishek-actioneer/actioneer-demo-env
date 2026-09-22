import { clerk } from '@clerk/testing/playwright';
import { test as setup, expect } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';
import path from 'path';

export const STORAGE_STATE = path.join(__dirname, '../playwright/.clerk/user.json');

// Self-contained E2E identity. This Clerk instance is passwordless, so we
// provision a synthetic test user via the Backend API and sign in with a
// backend-minted ticket (no password, no OTP entry). The user is created
// once and reused on subsequent runs.
const TEST_EMAIL =
  process.env.E2E_CLERK_USER_USERNAME || 'sentinel.e2e+clerk_test@example.com';

// Mark the user as onboarded so the app lands on '/' instead of redirecting
// to the onboarding wizard.
const PUBLIC_METADATA = {
  onboardingComplete: true,
  selectedSampleDatasets: ['vastu-hfc', 'fundsindia', 'presto'],
  orgName: 'E2E Test Co',
};

setup('authenticate', async ({ page }) => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error('CLERK_SECRET_KEY is required to provision the E2E test user');
  }
  const clerkClient = createClerkClient({ secretKey });

  // Find-or-create the synthetic test user.
  const existing = await clerkClient.users.getUserList({ emailAddress: [TEST_EMAIL] });
  const userId =
    existing.data[0]?.id ??
    (
      await clerkClient.users.createUser({
        emailAddress: [TEST_EMAIL],
        skipPasswordRequirement: true,
        publicMetadata: PUBLIC_METADATA,
      })
    ).id;

  // Ensure metadata is current (covers a pre-existing user missing it).
  await clerkClient.users.updateUser(userId, { publicMetadata: PUBLIC_METADATA });

  // Land on a Clerk-loaded page, establish the session, THEN navigate to the
  // (now-authenticated) home route. Going to '/' before sign-in bounces to
  // /auth and never comes back.
  await page.goto('/auth');
  await clerk.signIn({ page, emailAddress: TEST_EMAIL });
  await page.goto('/');
  await expect(page).toHaveURL('/');
  // Bake a "returning user" flag into the saved storage state so the one-time
  // welcome modal (a full-screen overlay that intercepts clicks) never sits
  // over the UI in tests.
  await page.evaluate(() => localStorage.setItem('sentinel-welcome-shown', '1'));
  await page.context().storageState({ path: STORAGE_STATE });
});
