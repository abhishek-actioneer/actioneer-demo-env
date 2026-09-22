---
module: Deployment
date: 2026-02-23
problem_type: best_practice
component: tooling
symptoms:
  - "User-uploaded dynamic datasets disappear after Railway redeploy"
  - "GET /api/datasets returns only static datasets after restart"
root_cause: incomplete_setup
resolution_type: documentation_update
severity: medium
tags: [railway, filesystem, dynamic-datasets, volumes, persistence, deployment]
---

# Troubleshooting: Dynamic Dataset Uploads Don't Persist on Railway

## Problem

vimarsh's dynamic dataset system stores user-uploaded CSV files and `config.json` metadata in `data/datasets/<id>/` on the local filesystem. On Railway, the container filesystem is ephemeral — this directory is wiped on every redeploy, container restart, or crash recovery.

## Environment

- Module: Deployment / Dataset System
- Stack: Next.js 16 (App Router), Railway hosting
- Affected Component: `src/lib/datasets/dynamic-registry.ts`, `src/app/api/datasets/upload/route.ts`
- Date: 2026-02-23

## Symptoms

- User uploads a CSV dataset successfully during a session
- After Railway redeploys (or the container restarts), `GET /api/datasets` only returns the static datasets (`ecommerce`, `quickhelp`)
- The uploaded CSV file and its `config.json` are gone from `data/datasets/`
- No error is thrown — the dynamic registry silently returns empty when the directory doesn't exist

## What Didn't Work

**Assuming filesystem persistence:** Railway containers do NOT have persistent filesystem by default. The `data/datasets/` directory lives inside the container image volume, which is re-created fresh on each deploy. Static datasets are unaffected because they are hardcoded TypeScript modules — not filesystem artifacts.

## Solution

**For persistence of user-uploaded dynamic datasets on Railway, mount a Railway Volume at `/app/data/datasets`.**

### Steps:

1. In the Railway dashboard → your service → **Volumes** tab → **Add Volume**
2. Mount path: `/app/data/datasets`
3. Size: start with 1 GB (adjustable)
4. Redeploy the service

The `dynamic-registry.ts` reads from `resolve(process.cwd(), "data/datasets")` which maps to `/app/data/datasets` in Railway's container. With a Volume mounted there, uploads survive redeploys.

```bash
# Verify in Railway shell after mounting:
ls /app/data/datasets   # should persist across deploys
```

### What is NOT affected

Static datasets (`ecommerce`, `quickhelp`) are hardcoded TypeScript exports — they don't use the filesystem and work correctly without any Volume. The `startup.sh` parquet download also writes to `/app/data/parquet/` which is a separate path (also ephemeral, but re-downloaded on each cold boot by `startup.sh`).

```
/app/data/
  parquet/        ← re-downloaded by startup.sh on cold boot (ephemeral OK)
  ecommerce.duckdb ← rebuilt by setup-data.ts on cold boot (ephemeral OK)
  datasets/       ← user uploads MUST be on a Railway Volume
    <upload-id>/
      config.json
      data.csv
      schema-map.json
```

## Why This Works

Railway Volumes are network-attached persistent storage (like a mounted disk). Unlike the container filesystem, Volumes survive container restarts, redeploys, and crashes. The `dynamic-registry.ts` uses standard Node.js `fs` calls (`readdirSync`, `readFileSync`, `writeFileSync`) — these work identically with a mounted Volume as with local filesystem.

## Prevention

- When deploying any feature that writes to the local filesystem and expects persistence → **always check if Railway Volumes are configured**
- Add a startup check in `dynamic-registry.ts` or the datasets API route that logs a warning if `data/datasets/` is not a mounted Volume (currently no such check exists)
- Document Volume requirements in `DEPLOY.md` alongside the parquet download instructions

## Related Issues

No related issues documented yet.
