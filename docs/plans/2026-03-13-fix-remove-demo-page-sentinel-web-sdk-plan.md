---
title: "fix: Remove demo page and @sentinel/web-sdk dependency"
type: fix
date: 2026-03-13
---

# fix: Remove demo page and @sentinel/web-sdk dependency

The `/demo` page (Lumière storefront showcase) imports from `@sentinel/web-sdk` which is declared as a local `file:../SDKs/web` dependency pointing outside the repo. This breaks `pnpm build` on every CI run, Railway deployment, and fresh clone. The demo is not part of the core app — removing it restores a clean build.

## Acceptance Criteria

- [ ] `pnpm build` completes with 0 errors
- [ ] `node_modules/@sentinel` entry is gone after `pnpm install`
- [ ] `pnpm-lock.yaml` has no `@sentinel/web-sdk` entry
- [ ] No broken links in sidebar or layout to `/demo`

## Changes

| File | Action |
|------|--------|
| `src/app/demo/` | Delete entire directory |
| `src/app/api/demo/` | Delete entire directory (two LLM wrapper routes, demo-only) |
| `public/sentinel-sdk.js` | Delete (only loaded by demo page) |
| `package.json` | Remove `"@sentinel/web-sdk": "file:../SDKs/web"` |
| `next.config.ts` | Remove `"@sentinel/web-sdk"` from `transpilePackages` array |
| `src/components/layout-shell.tsx:18` | Remove `\|\| pathname === "/demo"` from provider bypass condition |

Then run `pnpm install` to regenerate the lockfile.

## Context

- `@sentinel/web-sdk` is only imported in `src/app/demo/page.tsx` — no production code depends on it
- `/demo` has no sidebar nav link; no users can navigate to it organically
- `src/app/api/demo/` routes (`analyze`, `generate-content`) are standalone LLM wrappers with no SDK imports — safe to delete
- `layout-shell.tsx` has a provider bypass for `/demo` (mirrors the `/login` bypass) — removing it is a cleanup only, since the route is gone
- If the SDK needs to be re-integrated later, the correct path is publishing to a registry or using `workspace:*` — see `docs/solutions/build-errors/local-file-dependency-missing-sentinel-web-sdk.md`
