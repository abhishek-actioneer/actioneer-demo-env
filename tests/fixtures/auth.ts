/**
 * Auth helpers for Clerk-based authentication in tests.
 *
 * Browser tests: Use storageState from auth.setup.ts (configured in playwright.config.ts).
 * API tests: Use storageState which auto-injects Clerk session cookies.
 *
 * The old session_token / APP_PASSWORD system has been replaced by Clerk.
 */

// No-op helpers kept for backwards compatibility during migration.
// API tests that used authHeaders() now rely on storageState instead.
