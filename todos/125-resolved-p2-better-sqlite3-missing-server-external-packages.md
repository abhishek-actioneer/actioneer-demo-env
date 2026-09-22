---
status: pending
priority: p2
issue_id: "125"
tags: [code-review, build, sqlite, pr-48]
dependencies: []
---

# better-sqlite3 likely missing from serverExternalPackages — production build will fail

## Problem Statement

`next.config.ts` already externalizes `@duckdb/node-api` via `serverExternalPackages` because DuckDB is a native Node addon that cannot be bundled by Webpack. `better-sqlite3` is also a native Node addon. If it is not listed in `serverExternalPackages`, the production build will fail or produce a broken bundle that throws at runtime.

This is a production build blocker.

## Findings

Source: Architecture Strategist.

- `next.config.ts` — has `serverExternalPackages: ["@duckdb/node-api"]` (existing)
- `better-sqlite3` added as a dependency in this PR (`package.json`)
- Native addons (.node files) cannot be bundled by Webpack — must be externalized
- Same issue previously fixed for DuckDB — same fix needed for SQLite

## Proposed Solutions

**Option A (Recommended): Add to serverExternalPackages**
```ts
// next.config.ts
serverExternalPackages: ["@duckdb/node-api", "better-sqlite3"],
```
- Effort: Trivial | Risk: None

## Recommended Action

Option A — one-line fix.

## Technical Details

- **Affected files:** `next.config.ts`
- Symptoms if missing: `Module not found: Can't resolve 'better-sqlite3'` at build time, or runtime crash with "The edge runtime does not support Node.js 'fs' module"

## Acceptance Criteria

- [ ] `better-sqlite3` in `serverExternalPackages` array in `next.config.ts`
- [ ] `pnpm build` completes without errors
- [ ] SQLite operations work in production

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (architecture-strategist) | All native Node addons must be externalized in Next.js — check when adding new native deps |

## Resources

- PR #48: Unified Chart System + Server Persistence
- Next.js docs: serverExternalPackages
