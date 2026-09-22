---
title: "feat: Deploy Baby Sentinel to Railway for Customer Demos"
type: feat
date: 2026-02-23
---

# Deploy Baby Sentinel to Railway for Customer Demos

## Overview

Deploy Baby Sentinel as a persistent, publicly accessible demo environment for customer walkthroughs. After evaluating both Vercel and Railway, **Railway is the only viable option** without architectural changes. This plan covers why, and exactly how to deploy.

---

## Vercel vs. Railway Decision

### ❌ Vercel — Not Compatible (Without Major Rewrite)

Vercel's serverless architecture is fundamentally incompatible with Baby Sentinel as-is:

| Constraint | Why It Blocks Us |
|---|---|
| **Serverless functions** | Each request gets a cold-started, ephemeral container. DuckDB cannot exist in this model — it's an in-process database held as a singleton across the entire server lifetime. |
| **No persistent filesystem** | Vercel functions have no writable disk. The `data/` directory (parquet files, `.duckdb` files) cannot exist. |
| **Native `.node` addons** | `@duckdb/node-api` loads a compiled platform-specific binary (`.node` file). Vercel's serverless runtime does not support arbitrary native addons. |
| **Function timeout** | Vercel limits serverless functions to 60s (Pro plan). Deep analysis mode takes 60–90s wall-clock time. |
| **No streaming from functions** | `/api/analyze` streams NDJSON for the lifetime of the request. Vercel's function model does not support long-held streaming responses of this kind. |

> **Bottom line:** Making Baby Sentinel work on Vercel would require replacing DuckDB with a managed database, rewriting all API routes as stateless functions, and eliminating the long-streaming pattern. That's a significant architectural rewrite — not worth it for a demo environment.

**One exception to note:** The *frontend* (static assets, client JS) would work on Vercel fine. It's the backend/API layer that's blocked.

---

### ✅ Railway — Fully Compatible

Railway runs a persistent, long-lived container (like a traditional server). Every constraint above is resolved:

| Requirement | Railway Support |
|---|---|
| **Persistent process** | ✅ `next start` runs as a Node.js server. Process lives for hours/days. |
| **Writable filesystem** | ✅ Persistent volumes can be mounted at `/app/data/`. |
| **Native `.node` binaries** | ✅ Linux x64 container — `@duckdb/node-bindings-linux-x64` installs automatically. |
| **Long streaming responses** | ✅ No timeout limit on response duration. |
| **Environment variables** | ✅ First-class secret management in Railway dashboard. |

**Known pre-existing DuckDB fix:** The connection leak that caused SIGBUS crashes (exit 138) after multiple navigations has already been resolved via the promise-based singleton in `src/lib/db.ts:39-41`. This is safe for production.

---

## The One Real Challenge: Data Files

The dataset files are **gitignored** and **not in the repo**. Railway doesn't magically have them. This is the main thing to solve.

**What's needed at runtime:**
- `data/parquet/*.parquet` (preferred) — columnar, fast, smaller than CSV
- OR `data/csv/*.csv` (fallback) — ecommerce CSVs are 13.7 GB total
- `data/ecommerce.duckdb` — 3 MB, holds summary tables + segments/integrations (created by `setup-data.ts`)

**Two options for provisioning data:**

### Option A — Upload parquet files to Railway Volume (Recommended)

1. Deploy the app to Railway
2. Railway provisions a persistent volume mounted at `/app/data`
3. Use the Railway CLI or shell to upload parquet files from your local machine into the volume:
   ```bash
   railway shell
   # Inside the container:
   mkdir -p /app/data/parquet
   # Upload using rclone, scp, or direct Railway shell file transfer
   ```
4. Run setup to initialize DuckDB:
   ```bash
   railway run npx tsx scripts/setup-data.ts
   ```
5. The `.duckdb` file is created in the volume and persists across deploys.

### Option B — Bake data into the Docker image (Not Recommended)

Build a Docker image with the parquet files copied in. The image would be 500MB–2GB depending on parquet compression. This is slow to build, slow to push, and the data is baked in (can't update without rebuild).

---

## Implementation Steps

### Step 1: Create a Railway Project

- Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
- Point to the `baby-sentinel` repo
- Railway auto-detects Next.js

### Step 2: Configure Build & Start Commands

In Railway project settings:

```
Build command: pnpm install && pnpm build
Start command: pnpm start
```

Railway will use these automatically for the Node.js service.

### Step 3: Add Environment Variables

In Railway → Variables:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Your Google AI Studio key |
| `GEMINI_MODEL` | `gemini-2.0-flash` (or leave unset for default) |
| `NODE_ENV` | `production` |

### Step 4: Add a Persistent Volume

- Railway → Service → Volumes → Add Volume
- Mount path: `/app/data`
- Size: at least 2 GB for parquet files + DuckDB files

### Step 5: Provision Data Files

After first deploy succeeds (app will start but show DB errors):

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login

# Open a shell into the running container
railway shell

# Inside container: verify volume is mounted
ls /app/data/

# Use curl/wget to download parquet files if hosted somewhere,
# or use rclone to pull from S3/GCS/Backblaze
rclone copy remote:bucket/parquet /app/data/parquet

# Run setup to initialize DuckDB
npx tsx scripts/setup-data.ts
```

> **Tip:** If parquet files aren't hosted anywhere yet, use the `rclone` skill to upload them from your local machine to a cloud bucket first, then pull from there into Railway.

### Step 6: Verify Deployment

```bash
# Check health endpoint
curl https://your-app.railway.app/api/health

# Should return: { "status": "ok", "db": "ready" }
```

### Step 7: Set Up a Custom Domain (Optional for demos)

Railway → Service → Settings → Add Custom Domain. A clean URL like `demo.yourcompany.com` looks better in customer calls than `xyz.railway.app`.

---

## Resource Configuration

For customer demo usage (low concurrency):

| Resource | Minimum | Recommended |
|---|---|---|
| RAM | 1 GB | 2 GB |
| CPU | 1 vCPU | 2 vCPU |
| Disk (volume) | 2 GB | 5 GB |

The ecommerce dataset scanning 110M rows in deep research mode will spike RAM. 2 GB ensures the process doesn't OOM-kill mid-demo.

---

## What to Watch in Production

- **Silent crashes** (exit code 138) — SIGBUS from DuckDB. Means the `.duckdb.wal` is corrupted from an unclean shutdown. Fix: delete `data/ecommerce.duckdb` and `data/ecommerce.duckdb.wal` from the volume, re-run `setup-data.ts`. The promise-based singleton prevents the original connection leak cause.
- **Memory usage** — Monitor Railway's metrics dashboard. If RAM consistently exceeds 1.5 GB, bump to 2 GB plan.
- **Cold start on first request** — Railway may sleep inactive services (on lower plans). Consider setting up a health check ping to keep it warm.

---

## Acceptance Criteria

- [ ] App deploys from GitHub via Railway CI/CD
- [ ] `/api/health` returns `{ status: "ok", db: "ready" }`
- [ ] Chat query (analytics mode) completes and streams a response
- [ ] Deep research mode completes without timeout
- [ ] Segments panel loads and displays data
- [ ] App persists DuckDB state across redeploys (segments saved in volume survive)
- [ ] Custom domain configured (optional)

---

## References

- Railway docs: [docs.railway.app](https://docs.railway.app)
- DuckDB Node API: `@duckdb/node-api` v1.4.4
- DuckDB singleton: `src/lib/db.ts:39-41`
- Data setup script: `scripts/setup-data.ts`
- Connection leak fix: `docs/solutions/database-issues/duckdb-connection-leak-server-crash-System-20260219.md`
- Next.js deployment: `next.config.ts` (serverExternalPackages already configured)
