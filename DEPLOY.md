# Deploying to Railway

Baby Sentinel runs as a persistent Node.js server. Railway is the deployment target — Vercel is incompatible due to DuckDB's native binary and persistent filesystem requirements.

## One-time Railway Setup

### 1. Create the project

- Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub Repo
- Select the `baby-sentinel` repo and the `main` branch
- Railway will auto-detect the `railway.toml` config

### 2. Add environment variables

In Railway → Your Service → Variables:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Your Google AI Studio key |
| `GEMINI_MODEL` | `gemini-3-flash-preview` *(optional — this is the default)* |

### 3. Add persistent volume

Railway allows **one volume per service**. Mount it at `/app/data` — this single volume covers all persistent paths as subdirectories.

Railway → Your Service → Volumes → Add Volume:

| Field | Value |
|---|---|
| **Mount path** | `/app/data` |
| **Size** | 5 GB recommended |

This volume stores the ecommerce parquet file, DuckDB database, and user-uploaded datasets (under `data/datasets/`). On the **first deploy**, `startup.sh` automatically downloads `events.parquet` from GCS and builds `ecommerce.duckdb` — this takes several minutes. On every **subsequent deploy**, the files already exist on the volume and startup completes in seconds.

> Without this volume, parquet and DuckDB files are rebuilt from scratch on every deploy (slow) and DuckDB state is not preserved between restarts.

### 4. Manual data provisioning (recovery only)

> **Normal case:** `startup.sh` automatically downloads the parquet file and builds the DuckDB database on first deploy. You do not need to do anything manually — just watch the deploy logs.

Use the steps below only if auto-provisioning fails (e.g. GCS download error) or you need to reset the database manually.

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login

# Open a shell into the running container
railway shell
```

Inside the shell:

```bash
# Verify the volume is mounted
ls /app/data/

# Option A: Download parquet files from cloud storage (fastest)
# Install rclone if needed, then:
rclone copy remote:your-bucket/parquet /app/data/parquet

# Option B: Download CSV files directly
mkdir -p /app/data/csv
# wget/curl the CSV files into /app/data/csv/

# Initialize DuckDB (creates summary tables)
cd /app
npx tsx scripts/setup-data.ts
```

The `setup-data.ts` script detects whether parquet or CSV files are present and builds the database accordingly. It takes a few minutes for 110M rows.

### 5. Verify

```bash
curl https://your-app.railway.app/api/health
# → {"dbReady":true}
```

---

## Subsequent Deploys

Railway auto-deploys on every push to `main`. The persistent volume at `/app/data` survives redeploys — you don't need to re-provision data unless you want to update the dataset.

If the app crashes after a redeploy with a DuckDB error, the `.duckdb.wal` file may be corrupted. Fix:

```bash
railway shell
rm -f /app/data/ecommerce.duckdb /app/data/ecommerce.duckdb.wal
npx tsx scripts/setup-data.ts
```

---

## Resource Settings

For customer demos (low concurrency):

| Resource | Recommended |
|---|---|
| RAM | 2 GB |
| CPU | 2 vCPU |
| Volume | 5 GB |

Railway → Your Service → Settings → Resources to adjust.

---

## Keeping the Demo Warm

Railway may sleep inactive services on lower-tier plans. To prevent cold starts during demos, set up an uptime monitor (e.g., [UptimeRobot](https://uptimerobot.com)) to ping `/api/health` every 5 minutes.

## Dynamic Dataset Persistence

User-uploaded datasets are stored under `data/datasets/`, which is a subdirectory of the single `/app/data` volume. No separate volume is needed.

Static datasets (ecommerce, quickhelp) are unaffected — they are hardcoded TypeScript modules.
See: docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md
