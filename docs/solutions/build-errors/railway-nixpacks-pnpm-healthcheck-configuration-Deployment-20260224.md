---
module: Deployment
date: 2026-02-24
problem_type: build_error
component: tooling
symptoms:
  - "Railway deployments fail with 'pnpm: command not found' during Nixpacks build"
  - "healthcheckTimeout = 30s causes deploys to time out before Next.js starts"
  - "startup.sh crashes with 'tsx: command not found' on first run"
  - "Parquet download aborts on transient GCS network error (no retry)"
  - "DuckDB setup runs on every deploy instead of being skipped on warm boots"
root_cause: |
  Multi-factor deployment chain failure: (1) Nixpacks detects pnpm from pnpm-lock.yaml
  and configures PATH but never installs the binary — requires explicit packageManager
  field in package.json to trigger corepack; (2) healthcheck timeout (30s) is far too
  short for startup.sh to complete parquet download + DuckDB initialization before
  Next.js starts; (3) tsx used at runtime by startup.sh was declared only in
  devDependencies; (4) curl had no retry flags, making parquet downloads fragile.
resolution_type: configuration_fix
severity: high
tags: [railway, nixpacks, pnpm, corepack, healthcheck, duckdb, startup-script, tsx, volumes, deployment]
---

# Railway + Nixpacks Deployment Failures — pnpm Not Found, Healthcheck Timeout, tsx Runtime

## Environment

- Module: Deployment
- Stack: Next.js 16 (App Router), Railway hosting, Nixpacks builder, pnpm@10.27.0, DuckDB node-api
- Affected files: `railway.toml`, `package.json`, `scripts/startup.sh`
- Date: 2026-02-24

---

## Problems & Symptoms

### Problem 1: `pnpm: command not found` during build

Nixpacks detects pnpm from `pnpm-lock.yaml` and sets up a PATH entry for
`node_modules/.bin`, but **never installs the pnpm binary itself**. The generated
Dockerfile reaches `RUN pnpm i --frozen-lockfile` and fails with exit code 127.

```
/bin/bash: line 1: pnpm: command not found
ERROR: failed to build: process "/bin/bash -ol pipefail -c pnpm i --frozen-lockfile"
  did not complete successfully: exit code 127
```

### Problem 2: Healthcheck times out before Next.js starts

`railway.toml` had `healthcheckTimeout = 30`. The `startCommand` is
`bash scripts/startup.sh`, which runs sequentially:

1. Download `events.parquet` from GCS (~60 MB+, ~1-2 min)
2. Run `npx tsx scripts/setup-data.ts` — builds 5 DuckDB summary tables from 110M rows (~3-4 min)
3. `exec pnpm start` — Next.js server finally starts

Railway begins pinging `/api/health` immediately after the container starts. With a
30-second window, it kills the deployment before step 3 is reached.

### Problem 3: `tsx: command not found` at runtime

`scripts/startup.sh` calls `npx tsx scripts/setup-data.ts`. `tsx` was listed under
`devDependencies`. Nixpacks installs all deps during build (no `--prod` flag), so
`tsx` exists in the build image — but if Railway ever prunes devDependencies from
the runtime image, or if the build cache is warm and `node_modules` is incomplete,
the startup script fails silently.

### Problem 4: No retry on parquet download

```bash
curl -L "$PARQUET_URL" -o "$PARQUET_FILE"
```

With `set -e` active in startup.sh, a single transient GCS 500 or network timeout
aborts the entire startup. The container is marked unhealthy and enters a restart loop.

---

## Root Cause

All four issues are independent but compound each other. The primary blocker is
**Problem 1** (pnpm not installed) — without it, the build never completes. Once
that is fixed, **Problem 2** (healthcheck timeout) becomes the next failure point.

**Why Nixpacks doesn't install pnpm automatically:** Nixpacks uses the `packageManager`
field in `package.json` as the authoritative signal to invoke corepack. Without it,
Nixpacks sees `pnpm-lock.yaml` and attempts to use pnpm but never triggers the
installation step.

---

## Solutions

### Fix 1 — Add `packageManager` field to `package.json`

```diff
 {
   "name": "sentinel",
   "version": "0.1.0",
   "private": true,
+  "packageManager": "pnpm@10.27.0",
   "engines": {
     "node": "22"
   },
```

This tells Nixpacks to install pnpm via corepack before any build step runs.
The version must match your actual pnpm version (`pnpm --version` locally).

### Fix 2 — Raise `healthcheckTimeout` in `railway.toml`

```diff
-healthcheckTimeout = 30
+healthcheckTimeout = 300
```

**Note:** 300 seconds is Railway's documented default. The original `railway.toml` had `healthcheckTimeout = 30`, which explicitly overrode the default to a value far too short for this app's startup sequence. The fix restores the default.

300 seconds (5 minutes) covers the worst-case cold boot:
- Parquet download from GCS: ~1-2 min
- DuckDB setup (110M rows, 5 tables): ~3-4 min
- Next.js server startup: ~20 sec

On **warm boots** (data already exists on the volume), startup.sh skips both steps
and the app is ready in under 30 seconds — well within the 300s window.

### Fix 3 — Move `tsx` from `devDependencies` to `dependencies`

```diff
 "dependencies": {
+  "tsx": "^4.21.0",
   "zod": "^4.3.6"
 },
 "devDependencies": {
-  "tsx": "^4.21.0",
   "tailwindcss": "^4",
```

`startup.sh` calls `npx tsx` at container runtime. It must be in `dependencies`
to guarantee availability in the production image regardless of build cache state.

Run `pnpm install` after this change to update `pnpm-lock.yaml`.

### Fix 4 — Add curl retry flags in `startup.sh`

```diff
-  curl -L "$PARQUET_URL" -o "$PARQUET_FILE"
+  curl -L --retry 3 --retry-delay 5 "$PARQUET_URL" -o "$PARQUET_FILE"
```

Retries up to 3 times with a 5-second delay between attempts. Handles transient
GCS 5xx errors without aborting the deploy.

### Fix 5 — Add `engines` field to `package.json` (DuckDB ABI safety)

```diff
+  "engines": {
+    "node": "22"
+  },
```

`@duckdb/node-api` ships prebuilt platform-specific binaries tied to a specific
Node ABI version. Pinning Node 22 ensures the binary loaded at runtime matches
what was installed during the build.

---

## Final Configuration State

### `railway.toml`

```toml
[build]
builder = "NIXPACKS"
buildCommand = "pnpm install && pnpm build"

[deploy]
startCommand = "bash scripts/startup.sh"
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

### `nixpacks.toml`

```toml
[phases.setup]
nixPkgs = ["nodejs_22"]
```

### `package.json` (relevant fields)

```json
{
  "packageManager": "pnpm@10.27.0",
  "engines": { "node": "22" },
  "dependencies": {
    "tsx": "^4.21.0"
  }
}
```

### `scripts/startup.sh`

```bash
#!/bin/bash
set -e

PARQUET_FILE="/app/data/parquet/events.parquet"
PARQUET_URL="https://storage.googleapis.com/gc-prod-demoset/parquet/events.parquet"
DB_FILE="/app/data/ecommerce.duckdb"

# Log volume state on every boot
echo "=== Volume state at /app/data ==="
ls -lh /app/data 2>/dev/null || echo "(empty or not mounted)"
echo "=================================="

if [ ! -f "$PARQUET_FILE" ]; then
  echo "Parquet file not found. Downloading from GCS..."
  mkdir -p /app/data/parquet
  curl -L --retry 3 --retry-delay 5 "$PARQUET_URL" -o "$PARQUET_FILE"
  echo "Download complete."
else
  echo "Parquet file found on volume — skipping download."
fi

if [ ! -f "$DB_FILE" ]; then
  echo "Database not found. Running setup (this may take several minutes)..."
  cd /app
  npx tsx scripts/setup-data.ts
  echo "Setup complete."
else
  echo "Database found on volume — skipping setup."
fi

echo "Starting app..."
exec pnpm start
```

---

## Railway Volume Strategy

Railway supports **one volume per service**. Mount it at `/app/data` (5 GB) to
cover all persistent paths:

```
/app/data/                   ← single Railway Volume (5 GB)
  parquet/events.parquet     ← re-downloaded by startup.sh on cold boot if missing
  ecommerce.duckdb           ← rebuilt by setup-data.ts on cold boot if missing
  datasets/                  ← user-uploaded CSV datasets (persist on volume)
    <upload-id>/
      config.json
      data.csv
      schema-map.json
```

**Important Railway volume constraints (from docs):**
- One volume per service maximum — no second volume for subdirectories
- Volumes are **not available during `preDeployCommand`** — only during `startCommand`
- Volumes **cannot be downsized** once created — size only increases
- `RAILWAY_VOLUME_MOUNT_PATH` env var is auto-injected when a volume is attached
- Non-root Docker images need `RAILWAY_RUN_UID=0` for volume write permissions

---

## Deployment Checklists

### Pre-Deploy Checklist (every push to `main`)

- [ ] `package.json` has `"packageManager": "pnpm@X.Y.Z"` matching local pnpm version
- [ ] `tsx` is under `dependencies`, not `devDependencies`
- [ ] `railway.toml` has `healthcheckTimeout = 300`
- [ ] `startup.sh` curl commands have `--retry 3 --retry-delay 5`
- [ ] `GEMINI_API_KEY` is set in Railway Variables dashboard
- [ ] `pnpm build` passes locally with no TypeScript errors

### First-Deploy Checklist (one-time Railway setup)

- [ ] Create Railway service linked to `main` branch
- [ ] Set environment variables: `GEMINI_API_KEY`, optionally `GEMINI_MODEL`
- [ ] Add Volume: mount path `/app/data`, size 5 GB
- [ ] Deploy and watch logs — first deploy takes 8-15 minutes (parquet download + DuckDB setup)
- [ ] Verify: `curl https://<app>.railway.app/api/health` returns `{"dbReady":true}`
- [ ] Set up UptimeRobot to ping `/api/health` every 5 min to prevent cold sleep

### DuckDB WAL Corruption Recovery

If DuckDB refuses to open after an unclean shutdown:

```bash
railway shell
rm -f /app/data/ecommerce.duckdb /app/data/ecommerce.duckdb.wal
npx tsx scripts/setup-data.ts
```

---

## Prevention

- **Always declare `packageManager`** in `package.json` and update it when upgrading pnpm.
- **Any script called by `startup.sh` at runtime** must be in `dependencies`. Audit with:
  ```bash
  grep -oE 'npx [a-z-]+' scripts/startup.sh | awk '{print $2}'
  ```
- **Size volume generously on day 1** — Railway volumes cannot be downsized. Current parquet + DuckDB totals ~500MB-1GB; 5 GB gives comfortable headroom.
- **Never mount overlapping volumes** (e.g., `/app/data` and `/app/data/parquet` on the same service) — Railway's one-volume limit makes this impossible, but keep the single-parent-path design.
- **`preDeployCommand` cannot access volumes** — all data provisioning belongs in `startCommand` (startup.sh).

## Nixpacks Deprecation Note

**Nixpacks is officially in maintenance mode.** Railway now defaults to Railpack for new services. The `builder = "NIXPACKS"` setting in `railway.toml` continues to work, but receives no new features.

If you migrate to Railpack:
- Delete `nixpacks.toml` (Railpack ignores it)
- Change `railway.toml` to `builder = "RAILPACK"`
- Create a `railpack.json` if you need custom config (optional — auto-detection usually works)
- The `packageManager` field in `package.json` is respected by Railpack as well

**Recommendation:** Nixpacks is stable for this project. Migrate to Railpack in a staging environment before switching production.

## Related

- `DEPLOY.md` — full deployment guide with step-by-step setup
- `scripts/startup.sh` — boot script with data provisioning logic
- `docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md` — prior art on volume strategy for user uploads
