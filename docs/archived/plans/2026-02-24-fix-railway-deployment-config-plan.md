---
title: "fix: Railway deployment config — healthcheck timeout, tsx runtime, curl retry"
type: fix
date: 2026-02-24
---

# fix: Railway Deployment Config — Healthcheck Timeout, tsx Runtime, curl Retry

## Overview

Railway deploys are failing because `healthcheckTimeout = 30` in `railway.toml` is far too short. `startup.sh` downloads a parquet file from GCS and runs `setup-data.ts` against 110M rows before launching the Next.js server — a process that takes several minutes on first boot. Railway kills the deployment after 30 seconds when `/api/health` doesn't respond.

Three additional issues compound this: `tsx` (used by `startup.sh` to run `setup-data.ts`) is a devDependency rather than a regular dependency, there is no retry logic on the `curl` download, and `package.json` has no `engines` field to pin Node 22 for DuckDB ABI consistency.

No major architecture changes are needed — the existing `startup.sh`/volume approach is correct. These are targeted, surgical fixes.

---

## Problem Statement

### Root cause: healthcheck timeout is 30 seconds, setup takes minutes

`railway.toml` sets `healthcheckTimeout = 30`. Railway starts pinging `/api/health` immediately after the container launches. But `startup.sh` runs the following sequentially before `pnpm start`:

1. Download `events.parquet` from GCS (60+ MB)
2. Run `npx tsx scripts/setup-data.ts` (builds 5 DuckDB summary tables from 110M rows)
3. `exec pnpm start` (Next.js server starts)

On a first deploy (cold volume), steps 1–2 take several minutes. The Next.js server doesn't start until step 3. Railway times out at 30 seconds, marks the deploy failed, and triggers retries — each starting setup from scratch.

### Secondary issue: `tsx` is in devDependencies

`scripts/startup.sh` calls `npx tsx scripts/setup-data.ts`. `tsx` is listed under `devDependencies` in `package.json`. Because `railway.toml`'s `buildCommand` is `pnpm install && pnpm build` (without `--prod`), devDeps ARE installed at build time. However, there is implicit risk: if Railway prunes devDependencies after build, or if the build cache is warm and `node_modules` doesn't contain `tsx`, the startup script will silently fail with `sh: tsx: not found`.

Moving `tsx` to `dependencies` guarantees it is present at runtime regardless of how Railway manages the build/runtime split.

### Secondary issue: no curl retry in startup.sh

The parquet download is a single `curl -L` call with no retry flags. A transient GCS network hiccup during Railway's cold boot will fail the entire deployment — and because `set -e` is active, the script exits immediately.

### Secondary issue: no `engines` field in package.json

`nixpacks.toml` pins `nodejs_22` in the Nix package set, which correctly installs Node 22 during the build. However, without an `engines` field in `package.json`, there is no ABI-level guarantee that matches the platform-specific DuckDB binary (`@duckdb/node-bindings-linux-x64`) to the Node version. If Nixpacks ever resolves a different Node 22.x patch that changes the ABI, DuckDB will fail to load.

---

## Proposed Solution

Four targeted changes across three files:

1. **`railway.toml`** — raise `healthcheckTimeout` from `30` to `300`
2. **`scripts/startup.sh`** — add `--retry 3 --retry-delay 5` to the curl download
3. **`package.json`** — move `tsx` from `devDependencies` to `dependencies`; add `engines: { node: "22" }`
4. **`DEPLOY.md`** — update the volume section to reflect the two-volume strategy (existing doc partially covers this but is inconsistent)

---

## Technical Considerations

### Why 300 seconds?

`healthcheckTimeout` sets the total window Railway waits for the first successful healthcheck. 300 seconds (5 minutes) covers:
- ~30s for parquet download (60 MB from GCS is fast, but subject to cold-start overhead)
- ~3–4 minutes for `setup-data.ts` (110M rows, 5 summary tables)
- ~20s for Next.js server startup

Once the volume is seeded (all subsequent deploys), `startup.sh` skips both steps and the app starts in under 30 seconds — well within the 300s window.

**After first deploy:** You can optionally reduce `healthcheckTimeout` back to 60 seconds once the volume is seeded, since subsequent cold boots are fast (data already exists on the volume). But 300s is harmless for steady-state deploys.

### Volume strategy: two volumes or one?

`DEPLOY.md` mentions two different mount paths, which is confusing:

| Section | Mount path | Purpose |
|---|---|---|
| Step 3 (main setup) | `/app/data` | Parquet + DuckDB |
| Bottom section | `/app/data/datasets` | User-uploaded datasets |

**These are two separate volumes.** You need both if you want both ecommerce data AND user-uploaded datasets to persist. They cannot be the same volume because Railway volumes are mounted at a single path.

However, `/app/data` covers `/app/data/parquet` and `/app/data/ecommerce.duckdb`. The `startup.sh` already handles cold-boot provisioning of these paths. The `/app/data/datasets` volume is only required for the dynamic dataset upload feature.

For a minimal working demo deploy, **one volume at `/app/data` is sufficient** — `startup.sh` auto-provisions the ecommerce data. The second volume (`/app/data/datasets`) is only needed if users will be uploading custom CSV files.

### Why `tsx` must be in `dependencies`

Node.js (via `exec pnpm start` → `startup.sh`) runs at container runtime, not at build time. npm/pnpm treat `devDependencies` as build-time only. Railway may or may not prune them from the final runtime image depending on the Nixpacks version and cache behavior. Moving `tsx` to `dependencies` makes the intent explicit and eliminates the ambiguity entirely.

### The health endpoint returns 200 regardless of `dbReady`

`src/app/api/health/route.ts` always returns HTTP 200 with `{ dbReady: boolean }`. Railway's healthcheck only needs a 200 — it doesn't inspect the JSON body. This is correct: we want Railway to wait until the server is up, not until DuckDB is fully ready (which would require DuckDB to be initialized before the health check passes, creating a chicken-and-egg problem on warm restarts). The real DB readiness gate is the `startup.sh` ordering.

---

## Acceptance Criteria

- [ ] `railway.toml` has `healthcheckTimeout = 300`
- [ ] `scripts/startup.sh` curl command includes `--retry 3 --retry-delay 5`
- [ ] `tsx` is listed under `dependencies` (not `devDependencies`) in `package.json`
- [ ] `package.json` has `"engines": { "node": "22" }`
- [ ] `DEPLOY.md` volume section clearly documents the two-volume strategy with mount paths
- [ ] First deploy on Railway succeeds: `/api/health` returns `{"dbReady":true}` within 300 seconds

---

## Files to Change

### `railway.toml`

```toml
[build]
builder = "NIXPACKS"
buildCommand = "pnpm install && pnpm build"

[deploy]
startCommand = "bash scripts/startup.sh"
healthcheckPath = "/api/health"
healthcheckTimeout = 300          # was 30 — must survive parquet download + DB setup on first boot
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

### `scripts/startup.sh`

```bash
# Change this line:
curl -L "$PARQUET_URL" -o "$PARQUET_FILE"

# To this:
curl -L --retry 3 --retry-delay 5 "$PARQUET_URL" -o "$PARQUET_FILE"
```

### `package.json`

Move `tsx` from `devDependencies` to `dependencies`. Add `engines` field:

```json
{
  "engines": {
    "node": "22"
  },
  "dependencies": {
    ...
    "tsx": "^4.21.0"
  },
  "devDependencies": {
    // tsx removed from here
  }
}
```

### `DEPLOY.md` — Volume section update

Clarify the two-volume strategy:

```markdown
### Volume 1: Core data (parquet + DuckDB)
- Mount path: `/app/data`
- Size: 5 GB recommended
- Required for: ecommerce dataset (auto-provisioned by startup.sh on first boot)

### Volume 2: User uploads (optional)
- Mount path: `/app/data/datasets`
- Size: 1 GB
- Required for: dynamic CSV dataset uploads to persist across redeploys
- If omitted: uploaded datasets are lost on every redeploy
```

---

## Implementation Order

1. Edit `railway.toml` — change `healthcheckTimeout`
2. Edit `scripts/startup.sh` — add curl retry flags
3. Edit `package.json` — move `tsx`, add `engines`
4. Update `DEPLOY.md` — clarify volume section
5. `git push` to trigger Railway redeploy
6. In Railway dashboard: verify volume is mounted at `/app/data`; add `GEMINI_API_KEY` if not already set
7. Monitor first deploy logs — confirm parquet download + setup completes before server starts

---

## Dependencies & Risks

**Risk: `pnpm-lock.yaml` changes when moving `tsx` to `dependencies`.**
Moving a package between dep sections updates the lockfile. This is safe and expected — just commit the lockfile alongside the `package.json` change.

**Risk: Existing Railway volume at wrong mount path.**
If a volume was previously mounted at `/app/data/parquet` instead of `/app/data`, the parquet file won't be found at restart and will re-download. Check the Railway dashboard volume mount path before deploying.

**Risk: Stale DuckDB WAL file after ungraceful shutdown.**
If a previous deploy was killed mid-write, `ecommerce.duckdb.wal` may be corrupted. The `startup.sh` check only looks for `ecommerce.duckdb`, not the WAL file. If you see DuckDB errors after a successful deploy, run in Railway shell:
```bash
rm -f /app/data/ecommerce.duckdb /app/data/ecommerce.duckdb.wal
npx tsx scripts/setup-data.ts
```

---

## References

- `railway.toml` — `railway.toml:8`
- `startup.sh` — `scripts/startup.sh:12`
- `package.json` — `package.json:41` (`tsx` in devDependencies)
- Health endpoint — `src/app/api/health/route.ts`
- Volume best practices — `docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md`
- Deploy docs — `DEPLOY.md`
