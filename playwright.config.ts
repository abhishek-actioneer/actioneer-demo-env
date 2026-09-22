import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
    },
  },
  projects: [
    // Global Clerk setup — runs first
    {
      name: 'clerk-setup',
      testMatch: /global\.setup\.ts/,
    },
    // Authenticate a test user — depends on Clerk setup
    {
      name: 'auth-setup',
      testMatch: /auth\.setup\.ts/,
      dependencies: ['clerk-setup'],
    },
    // API tests — authenticated via storageState
    {
      name: 'api',
      testDir: './tests/api',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.clerk/user.json',
      },
      dependencies: ['auth-setup'],
    },
    // E2E tests — authenticated via storageState
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.clerk/user.json',
      },
      dependencies: ['auth-setup'],
    },
    // Visual regression tests — authenticated via storageState
    {
      name: 'visual',
      testDir: './tests/visual',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        storageState: 'playwright/.clerk/user.json',
      },
      dependencies: ['auth-setup'],
    },
  ],
});
