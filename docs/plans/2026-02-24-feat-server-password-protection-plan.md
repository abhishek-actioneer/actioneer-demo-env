---
title: "feat: Server-Controlled Password Protection"
type: feat
date: 2026-02-24
---

# feat: Server-Controlled Password Protection

## Overview

Gate the entire Baby Sentinel app behind a single shared password enforced at the server level via Next.js middleware. Any visitor from a fresh browser must pass a login screen before accessing any page or API route. Authenticated state is stored in a HttpOnly, Secure, SameSite=Lax session cookie.

## Problem Statement / Motivation

Baby Sentinel is a demo/experiment app shared with external audiences. Currently, every page and API route is publicly accessible to anyone who knows the URL. A lightweight password gate prevents accidental or unauthorized access to the LLM endpoints (Gemini API calls), DuckDB query execution, and internal data without adding a full user authentication system.

## Proposed Solution

1. **`middleware.ts` at project root** — intercepts every request, checks for a valid session cookie, redirects unauthenticated requests to `/login`.
2. **`/login` page** — standalone form page in a `(auth)` route group, bypassing `LayoutShell` (no sidebar/topbar).
3. **`/api/auth/login` route** — POST handler validates submitted password against `APP_PASSWORD` env var, sets session cookie on success.
4. **`APP_PASSWORD` env var** — set in Railway dashboard and `.env.local` for local dev. Never hardcoded.

## Technical Considerations

### Middleware Design

- File location: `src/middleware.ts` (Next.js also accepts root `middleware.ts`; use `src/` to match existing conventions)
- Use a **static `matcher` export** to exclude exempt paths from middleware execution entirely (better performance than runtime conditionals):
  ```ts
  export const config = {
    matcher: [
      "/((?!_next/static|_next/image|favicon.ico|icon.svg|api/health|api/auth|login).*)",
    ],
  };
  ```
- Inside middleware, read `session_token` cookie. If absent or invalid → redirect to `/login?next=<encoded-original-url>`.
- If `APP_PASSWORD` is not set in environment → throw and return 503 so misconfigured deploys fail loudly.

### Cookie Structure

Use a **signed token** to prevent forgery:

- On login: generate a 32-byte random token via `crypto.randomUUID()`, sign it with `HMAC-SHA256` using a `SESSION_SECRET` env var.
- Store signed value in `session_token` cookie: `<token>.<hmac-hex>`.
- In middleware: split on `.`, verify HMAC, reject if tampered.
- Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Max-Age=604800` (7 days persistent, survives browser restarts — appropriate for demo audiences).

> **Note:** This requires a second env var `SESSION_SECRET` (a random 32+ char string). Add to `.env.local` and Railway.

### Login Page Layout

The `/login` route must **bypass `LayoutShell`** (which renders Sidebar/Topbar for authenticated users). Use a Next.js App Router route group:

- `src/app/(auth)/layout.tsx` — renders only `{children}` with ThemeProvider, no LayoutShell
- `src/app/(auth)/login/page.tsx` — standalone login form

The existing root `src/app/layout.tsx` keeps `LayoutShell` for all other routes.

### Post-Login Redirect Preservation

Middleware encodes the originally requested URL into the redirect:
```ts
const loginUrl = new URL("/login", request.url);
loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
return NextResponse.redirect(loginUrl);
```

The login handler reads `?next=` and redirects there after setting the cookie. Validates `next` is a relative path (no open redirects).

### Environment Variables Added

| Variable | Required | Description |
|---|---|---|
| `APP_PASSWORD` | Yes | The shared access password |
| `SESSION_SECRET` | Yes | Random 32+ char string for HMAC signing |

### Exempt Routes (never hit middleware)

| Path | Reason |
|---|---|
| `/_next/static/*`, `/_next/image/*` | Next.js build assets |
| `/favicon.ico`, `/icon.svg` | Browser favicon fetch (would cause redirect loop on login page) |
| `/api/health` | Railway healthcheck — must return 200 without a cookie |
| `/api/auth/*` | Login/logout endpoints — must be publicly reachable |
| `/login` | Login page itself |

## Acceptance Criteria

### Functional

- [x] Visiting any page without a session cookie redirects to `/login`
- [x] Visiting any `/api/*` route without a session cookie returns `302` to `/login` (not 200)
- [x] Entering the correct password on `/login` → sets `session_token` cookie → redirects to `/` (or `?next=` destination)
- [x] Entering wrong password → stays on `/login` → shows inline "Incorrect password" error message
- [x] After login, all pages and API routes are accessible without being redirected
- [x] `GET /api/health` returns `200` without any cookie (Railway healthcheck)
- [x] `/favicon.ico` and `/icon.svg` load without redirecting (no redirect loop on login page)
- [x] An already-authenticated user visiting `/login` is redirected to `/`
- [x] Session cookie persists for 7 days across browser restarts

### Security

- [x] `APP_PASSWORD` is read only from env var, never from code
- [x] Session cookie is `HttpOnly; Secure; SameSite=Lax`
- [x] Cookie value is HMAC-signed (tampered cookies rejected by middleware)
- [x] If `APP_PASSWORD` env var is not set, the app returns `503` on all protected routes
- [x] `?next=` redirect validates that the destination is a relative URL (prevents open redirect)

### UX

- [x] Login page renders without Sidebar or Topbar
- [x] Password input has a show/hide toggle
- [x] Enter key submits the form
- [x] Loading state shown while POST is in flight
- [x] Error state distinguishes "wrong password" (401) from network error (5xx)
- [x] Login page shows the "Sentinel" app name/branding

## Implementation Plan

### Phase 1 — Environment & Middleware (foundation)

1. Add `APP_PASSWORD` and `SESSION_SECRET` to `.env.local` (gitignored) and Railway dashboard
2. Create `src/lib/auth.ts` — `signToken()`, `verifyToken()`, `hashPassword()` utilities using Web Crypto API (Edge runtime compatible)
3. Create `src/middleware.ts` — cookie verification, exempt path matcher, redirect logic

### Phase 2 — Auth API Route

4. Create `src/app/api/auth/login/route.ts` — POST handler:
   - Parse JSON body `{ password: string }`
   - Constant-time compare against `APP_PASSWORD` (`crypto.subtle.timingSafeEqual` equivalent)
   - On success: `signToken()` → set cookie → `{ ok: true, redirectTo: next || "/" }`
   - On failure: `{ status: 401, body: { error: "Incorrect password" } }`

### Phase 3 — Login UI

5. Create `src/app/(auth)/layout.tsx` — minimal layout, ThemeProvider only
6. Create `src/app/(auth)/login/page.tsx` — client component with password form, error state, loading state, show/hide toggle

### Files Created

```
src/middleware.ts
src/lib/auth.ts
src/app/(auth)/layout.tsx
src/app/(auth)/login/page.tsx
src/app/api/auth/login/route.ts
```

### Files Modified

```
.env.local           ← add APP_PASSWORD, SESSION_SECRET
CLAUDE.md            ← document new required env vars
```

## Dependencies & Risks

- **No new npm packages required** — uses Web Crypto API (built into Node 22 / Edge runtime) and Next.js built-ins
- **Railway deployment:** Must add `APP_PASSWORD` and `SESSION_SECRET` to Railway env before deploying; missing vars will cause 503 on all routes (intentional fail-loud behavior)
- **Existing API clients:** If anything outside the browser calls these API routes (e.g., scripts, CI), they will now need to pass a valid session cookie or be added to the exempt list

## References

### Internal

- Middleware location: `src/middleware.ts` (no existing file)
- Root layout: `src/app/layout.tsx` (LayoutShell wraps all pages — must bypass for login)
- Health route (must stay exempt): `src/app/api/health/route.ts`
- Env var pattern: `src/lib/llm.ts:39` (existing `GEMINI_API_KEY` usage pattern)
- No existing cookie/session code in codebase

### External

- Next.js Middleware docs: https://nextjs.org/docs/app/building-your-application/routing/middleware
- Web Crypto API (Edge runtime): available globally in Next.js middleware
