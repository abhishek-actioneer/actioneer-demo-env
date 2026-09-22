---
title: Local file: Dependency Missing — @sentinel/web-sdk Build Failure
date: 2026-03-13
problem_type: build-error
component: src/app/demo/page.tsx
symptoms:
  - "Module not found: Can't resolve '@sentinel/web-sdk/demo/cart-abandonment'"
  - pnpm build fails when sibling directory ../SDKs/web does not exist on the machine
  - node_modules/@sentinel is absent — package was never installed or linked
  - Same failure reproduces on main branch (pre-existing, not branch-specific)
root_cause: package.json declares "@sentinel/web-sdk" as "file:../SDKs/web" — a local file dependency pointing to a sibling directory outside the repo that does not exist in CI, Railway, or fresh developer environments
tags:
  - pnpm
  - local-dependency
  - file-protocol
  - web-sdk
  - next-js
  - build
  - monorepo
severity: medium
related:
  - docs/solutions/build-errors/missing-collaborator-file-next-build-failure.md
  - docs/solutions/build-errors/nextjs-16-middleware-proxy-file-conflict.md
  - docs/solutions/build-errors/railway-nixpacks-pnpm-healthcheck-configuration-Deployment-20260224.md
---

# Local file: Dependency Missing — @sentinel/web-sdk Build Failure

## Problem

`pnpm build` fails with:

```
Module not found: Can't resolve '@sentinel/web-sdk/demo/cart-abandonment'
  at src/app/demo/page.tsx:5:1
```

`src/app/demo/page.tsx` imports multiple components and hooks from the SDK:

```typescript
import {
  StoreHeader,
  ProductCatalog,
  ProductModal,
  CommandCenter,
  InterventionBanner,
  CheckoutPage,
  GuidedTour,
  useCart,
  useSentinelSdk,
  useInterventions,
  useAiContent,
} from "@sentinel/web-sdk/demo/cart-abandonment";
import type { Product } from "@sentinel/web-sdk/demo/cart-abandonment";
```

## Root Cause

`package.json` declares the SDK as a local `file:` dependency:

```json
"@sentinel/web-sdk": "file:../SDKs/web"
```

This points to `../SDKs/web` — a directory **outside the repository root**, in a sibling directory. On machines where only this repo is cloned (CI, Railway, other developers), that path doesn't exist. `pnpm install` silently skips the package, `node_modules/@sentinel` is never created, and Next.js fails at build time when it can't resolve the import.

`next.config.ts` also references the package in `transpilePackages`, which means Next.js actively tries to bundle it.

## Investigation Steps

1. Ran `pnpm build` → failed with `Module not found` on `src/app/demo/page.tsx`
2. Checked `node_modules/@sentinel` → directory does not exist, confirming the package was never linked
3. Checked `package.json` → found `"@sentinel/web-sdk": "file:../SDKs/web"` — relative path escaping the repo
4. Verified the same failure on `main` branch → confirmed pre-existing; not introduced by any feature branch
5. Merge proceeded since build state was identical to `main` (no regression introduced)

## Working Solution — Short Term (Unblock Locally)

Check out (or copy) the SDK as a sibling of this repository, then reinstall:

```
parent-dir/
  baby-sentinel/    ← this repo
  SDKs/
    web/            ← SDK must exist here
```

```bash
# After ensuring ../SDKs/web exists:
pnpm install
pnpm build  # should succeed
```

Alternatively, stub out `src/app/demo/page.tsx` with a placeholder that doesn't import from the SDK:

```typescript
// src/app/demo/page.tsx — temporary stub
export default function DemoPage() {
  return <div>Demo unavailable in this environment.</div>;
}
```

## Working Solution — Proper Fix (Pick One)

**Option A — Remove the demo page** (if not shipped to users):
```bash
rm -rf src/app/demo/
# Remove "@sentinel/web-sdk" from package.json dependencies
# Remove "@sentinel/web-sdk" from transpilePackages in next.config.ts
pnpm install
```

**Option B — Publish the SDK to a registry** (recommended long term):
Replace the `file:` entry with a versioned specifier pointing to npm or a private registry:
```json
"@sentinel/web-sdk": "^1.0.0"
```

**Option C — Vendor the SDK inside the monorepo**:
Move `SDKs/web` into the repo under `packages/web-sdk/`, update the reference:
```json
"@sentinel/web-sdk": "file:./packages/web-sdk"
```
Then commit it so every clone has it. Declare it in `pnpm-workspace.yaml` and use `workspace:*`.

**Option D — Guard the import dynamically** (minimal change):
```typescript
// Wrap in dynamic import to prevent build-time failure
const DemoComponents = dynamic(() => import("@sentinel/web-sdk/demo/cart-abandonment"), {
  ssr: false,
});
```
Or gate the entire page with an env var so the route is excluded from builds without the SDK.

## Prevention

### Pre-merge Checklist for New Dependencies

- [ ] `grep '"file:' package.json` — confirm no `../` prefixes escaping the repo root
- [ ] `pnpm install` on a fresh clone (no pre-existing `node_modules`) succeeds without errors
- [ ] `pnpm build` on the fresh clone completes with 0 errors
- [ ] `pnpm-lock.yaml` has no new entries with absolute paths or out-of-repo paths
- [ ] New workspace packages listed in `pnpm-workspace.yaml`
- [ ] CI passed on the branch (not just local) before approving merge

### Detection

Quick grep to find all `file:` dependencies:

```bash
grep '"file:' package.json
```

Any entry starting with `file:../` points outside the repo and is a candidate for this problem.

After `pnpm install`, verify the package exists:

```bash
ls node_modules/@sentinel  # should exist if SDK linked correctly
```

### CI/CD Implications

- **GitHub Actions / Railway** clone only this repo. `file:../` paths are always outside the Docker build context → hard failure at `pnpm install` or first import.
- **Cached `node_modules` in CI can mask the problem** — invalidate the cache to surface broken `file:` deps early.
- **`pnpm-lock.yaml` encodes the broken path** — regenerating requires removing the dep, running `pnpm install`, and recommitting.
- **Always run `pnpm install --frozen-lockfile` in CI** to catch lockfile mismatches immediately.

### Best Practice: Use pnpm Workspaces for Internal Packages

Instead of `file:../SDKs/web`, bring the SDK into the monorepo:

```yaml
# pnpm-workspace.yaml
packages:
  - packages/*
```

```json
// package.json
"@sentinel/web-sdk": "workspace:*"
```

`workspace:*` resolves correctly on every machine and in CI because the path is always relative to the repo root.

### If file: Is Temporarily Unavoidable

Document it explicitly in `CLAUDE.md` and the README with setup instructions (e.g. "clone `SDKs/` as a sibling directory"). Add a TODO comment in `package.json` pointing to the tracking issue.
