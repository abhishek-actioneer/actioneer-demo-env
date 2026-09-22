---
title: "Next.js 16: middleware.ts and proxy.ts Cannot Coexist"
date: 2026-03-11
problem_type: build_error
component: Auth Middleware / Server Startup
symptoms:
  - "Dev server startup failure with 'Both middleware file and proxy file are detected'"
  - "Warning: The 'middleware' file convention is deprecated. Please use 'proxy' instead."
  - "Unhandled Rejection on server start"
  - "All routes redirect to /login (auth middleware not running)"
root_cause: "Next.js 16 renamed middleware.ts to proxy.ts. Having both files simultaneously causes startup failure."
tags:
  - next.js-16
  - middleware
  - proxy
  - auth
  - server-startup
related_files:
  - src/proxy.ts
---

# Next.js 16: middleware.ts and proxy.ts Cannot Coexist

## Symptoms

Dev server (`pnpm dev`) prints this and may fail to start or run without auth:

```
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
  Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
Unhandled Rejection: Error: Both middleware file "./src/middleware.ts" and
  proxy file "./src/proxy.ts" are detected. Please use "./src/proxy.ts" only.
  Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
```

## Root Cause

Next.js 16 renamed the middleware file convention:

| Next.js version | Auth middleware file | Export name |
|---|---|---|
| ≤15 | `src/middleware.ts` | `export function middleware` |
| 16+ | `src/proxy.ts` | `export function proxy` |

Having **both files** at the same time is a hard error — Next.js cannot determine which takes precedence.

This often happens when:
- A developer copies `middleware.ts` from another project or documentation
- A feature branch adds `middleware.ts` without deleting `proxy.ts`
- Merging branches that each only had one of the two files

## Fix

Delete `src/middleware.ts`. Keep only `src/proxy.ts`.

```bash
rm src/middleware.ts
```

Verify `src/proxy.ts` exists and exports `proxy` (not `middleware`):

```typescript
// src/proxy.ts — correct Next.js 16 pattern
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, validTokens } from "@/lib/auth";

export function proxy(request: NextRequest) {   // ← named "proxy" in Next.js 16
  // ... auth logic
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|api/health|api/auth|login).*)",
  ],
};
```

## Prevention

**Never create `src/middleware.ts` in this project.** Next.js 16 uses `src/proxy.ts`.

**Quick check when onboarding or after merging branches:**

```bash
ls src/middleware.ts 2>/dev/null && echo "❌ DELETE THIS FILE" || echo "✅ No middleware.ts"
ls src/proxy.ts 2>/dev/null && echo "✅ proxy.ts exists" || echo "❌ MISSING proxy.ts"
```

**Code review signal:** Any PR that adds `src/middleware.ts` as a new file should be rejected — redirect the author to `src/proxy.ts` instead.

## Related

- `src/proxy.ts` — The correct auth middleware for this project
- `src/lib/auth.ts` — `COOKIE_NAME`, `validTokens` set used by the proxy
- `src/app/api/auth/login/route.ts` — Login endpoint that issues session tokens
