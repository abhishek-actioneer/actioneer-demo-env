---
module: System
date: 2026-02-25
problem_type: best_practice
component: testing_framework
symptoms:
  - "Tests always pass regardless of whether the feature under test is broken"
  - "Auth cookie constant duplicated across 13 spec files — one change breaks all"
  - "CI catches that bare catch{} in db.ts swallows real disk/permission errors"
  - "Protected route test passes with HTTP 500 responses due to weak assertion"
  - "NDJSON parser function copy-pasted in two spec files"
root_cause: test_isolation
resolution_type: test_fix
severity: high
tags: [playwright, test-quality, no-op-tests, auth-fixture, catch-all, assertions, e2e, api-tests]
---

# Best Practice: Playwright Test Quality Anti-Patterns to Avoid

## Problem

A Playwright test suite (PR #17, `feat/playwright-test-suite`) was reviewed and found to contain several recurring quality issues. Tests that appeared to be verifying behavior were actually passing unconditionally. Additionally, infrastructure patterns (auth headers, NDJSON parser) were duplicated across files, and a `catch {}` block in production code was overly broad.

These patterns were flagged by multiple review agents (kieran-typescript-reviewer, pattern-recognition-specialist, architecture-strategist) and independently by Devin's code review tool.

## Environment

- Module: System-wide (test suite + src/lib/db.ts)
- Affected Component: `tests/api/`, `tests/e2e/`, `tests/fixtures/`, `src/lib/db.ts`
- Date: 2026-02-25

## Anti-Pattern 1: No-Op Tests with `if (count > 0)` Guards

### Symptom
```typescript
// ❌ WRONG: Test passes even if the button doesn't exist
test('can open create segment modal', async ({ page }) => {
  const createBtn = page.locator('button:has-text("Create")').first();
  if (await createBtn.count() > 0) {
    await createBtn.click();
    // ... assertions inside if-block
  }
  // Test passes if no errors — meaning it passes even if count === 0
});
```

### Fix
```typescript
// ✅ CORRECT: Assert the button exists, fail explicitly if it doesn't
test('create segment button is visible', async ({ page }) => {
  const createBtn = page.locator('button:has-text("Create")').first();
  await expect(createBtn).toBeVisible({ timeout: 10_000 });
});

test('clicking create segment opens modal', async ({ page }) => {
  const createBtn = page.locator('button:has-text("Create")').first();
  await expect(createBtn).toBeVisible({ timeout: 10_000 });
  await createBtn.click();
  const modal = page.locator('[role="dialog"]').first();
  await expect(modal).toBeVisible({ timeout: 5_000 });
});
```

**Root cause:** The `if (count > 0)` guard was added defensively to avoid selector failures, but it turns the test into a no-op when the element is missing. A broken UI would never surface.

---

## Anti-Pattern 2: `waitForTimeout` as Fallback for Selector Failure

### Symptom
```typescript
// ❌ WRONG: waitForTimeout masks real failures
await page.waitForSelector('[data-testid="agent-card"]', {
  timeout: 60_000,
}).catch(async () => {
  // Fallback: just wait for any new content beyond the input
  await page.waitForTimeout(5000); // test silently passes after 5s
});
```

### Fix
```typescript
// ✅ CORRECT: Proper assertion that fails when UI doesn't respond
await expect(
  page.locator('[data-testid="agent-card"], .agent-card').first()
).toBeVisible({ timeout: 60_000 });
```

**Root cause:** The catch + waitForTimeout pattern converts a test failure (UI didn't render) into a 5-second sleep, after which the test passes. If the chat feature breaks, this test will not catch it.

---

## Anti-Pattern 3: Auth Constant Duplicated in Every Test File

### Symptom
```typescript
// ❌ WRONG: Duplicated across 13 API spec files
// analyze.spec.ts, chat.spec.ts, classify.spec.ts, ... (13 files)
const AUTH = { Cookie: 'session_token=playwright-test-session' };
```

### Fix
```typescript
// ✅ CORRECT: Import from the single-source-of-truth fixture
import { authHeaders } from '../fixtures/auth';

// Usage:
const resp = await request.post('/api/analyze', {
  headers: authHeaders(),
  data: { ... },
});
```

**Root cause:** A shared `authHeaders()` function existed in `tests/fixtures/auth.ts` but was not used by any API spec files. If the cookie name or value changes, 13 files require updates. The fixture was built correctly but the convention was not enforced consistently.

---

## Anti-Pattern 4: Helper Functions Duplicated Across Spec Files

### Symptom
```typescript
// ❌ WRONG: parseNDJSON defined identically in analyze.spec.ts AND playbooks.spec.ts
function parseNDJSON(text: string): Array<Record<string, unknown>> {
  return text.split('\n').filter(...).map(...).filter(Boolean);
}
```

### Fix
```typescript
// ✅ CORRECT: Extract to tests/fixtures/ndjson.ts
// tests/fixtures/ndjson.ts
export function parseNDJSON(text: string): Array<Record<string, unknown>> { ... }

// In spec files:
import { parseNDJSON } from '../fixtures/ndjson';
```

---

## Anti-Pattern 5: Bare `catch {}` in Production Code Is Too Broad

### Symptom
```typescript
// ❌ WRONG: src/lib/db.ts — swallows ALL errors, not just the expected one
try {
  await conn.run(sql); // CREATE OR REPLACE VIEW
} catch {
  // VIEW creation skipped — a TABLE with that name already exists (CI/test mode)
}
```

### Fix
```typescript
// ✅ CORRECT: Only swallow the specific expected error, re-throw everything else
try {
  await conn.run(sql);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes("already exists") && !msg.includes("Catalog Error")) {
    throw err; // Disk errors, permission errors, malformed SQL → surface them
  }
}
```

**Root cause (flagged by Devin and TypeScript reviewer):** The CI workaround (`setup-test-data.ts` pre-seeds a TABLE so the VIEW creation fails gracefully) required a catch block. However, the bare `catch {}` silently swallows disk errors, permission errors, and DuckDB version incompatibilities. The app would start appearing healthy while the `events` view doesn't exist.

---

## Anti-Pattern 6: Weak Auth Bypass Assertion

### Symptom
```typescript
// ❌ WRONG: Accepts HTTP 500 as "not a redirect"
expect(resp.status()).not.toBe(302);
```

### Fix
```typescript
// ✅ CORRECT: Assert the request succeeded, not just that it didn't redirect
expect(resp.status()).toBeLessThan(400);
```

---

## Anti-Pattern 7: Dependent Tests Without Skip Guards

### Symptom
```typescript
// ❌ WRONG: segmentId is undefined if first test fails, causing confusing errors downstream
let segmentId: string;

test('creates segment', async ({ request }) => { segmentId = body.id; });
test('GET segment returns preview', async ({ request }) => {
  // segmentId is undefined if above test was skipped — produces misleading error
  const resp = await request.get(`/api/segments/${segmentId}`, ...);
});
```

### Fix
```typescript
// ✅ CORRECT: Guard downstream tests explicitly
test('GET segment returns preview', async ({ request }) => {
  test.skip(!segmentId, 'depends on create test');
  const resp = await request.get(`/api/segments/${segmentId}`, ...);
});
```

---

## Auth Security Note (Flagged by Devin)

The test suite uses `playwright-test-session` as the cookie value because the session validation is `!!token` (any non-empty string). This means:
- **The "test" cookie works in all environments including production deploys**
- Anyone who reads the repo can set `Cookie: session_token=playwright-test-session` in their browser

This is a known architectural issue with the demo app, not a test-suite problem. But when reviewing auth bypass tests, note that the bypass works because tokens are never stored or HMAC-validated — not because of a CI-only backdoor.

## Prevention

When generating Playwright test suites:
1. **Auth**: Always import `authHeaders()` from the shared fixture — never write `const AUTH = { Cookie: '...' }` inline
2. **No-op guards**: Never use `if (await element.count() > 0)` without a fallback assertion or explicit `test.skip`. Use `toBeVisible()` and let it fail.
3. **Fallback timeouts**: Never `.catch(() => page.waitForTimeout(N))` — this masks failures. Let the waitForSelector throw.
4. **Shared utilities**: `parseNDJSON`, auth helpers, cookie constants belong in `tests/fixtures/`. Don't repeat them per-spec.
5. **Serial test dependencies**: Always add `test.skip(!sharedVar, 'depends on X test')` when tests depend on shared state from a prior test.
6. **Catch blocks in production code**: Never use bare `catch {}` or `catch (e) {}` without inspecting the error. Narrow the caught error to the specific expected failure mode.
7. **Assertion strength**: `not.toBe(302)` accepts 500. Use `toBeLessThan(400)` for "passes auth" assertions.

## Related Issues

No related issues documented yet.
