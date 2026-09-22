#!/bin/bash
set -e

# Railway injects service variables into the shell env but NOT into the Docker
# runtime env. Write them to .env.local so Next.js picks them up at runtime.
# Only writes vars that are set in the shell but missing from the process env.
echo "Writing Railway service variables to .env.local..."
ENV_LOCAL="/app/.env.local"
: > "$ENV_LOCAL"
for var in OPENAI_API_KEY OPENAI_MODEL OPENAI_IMAGE_MODEL CLERK_SECRET_KEY NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
           NEXT_PUBLIC_CLERK_SIGN_IN_URL NEXT_PUBLIC_CLERK_SIGN_UP_URL \
           NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL \
           DUCKDB_MEMORY_LIMIT DUCKDB_THREADS NODE_OPTIONS APP_PASSWORD SESSION_SECRET \
           NEXT_PUBLIC_BASE_URL VOICE_STORAGE_DIR CEREBRAS_API_KEY NEXT_PUBLIC_TLDRAW_LICENSE_KEY \
           CRON_SECRET SYNTHETIC_ENABLED SYNTHETIC_LEADER SYNTHETIC_ADMIN_USER_IDS \
           PLIVO_AUTH_ID PLIVO_AUTH_TOKEN PLIVO_PHONE_NUMBER \
           GOOGLE_API_KEY GEMINI_API_KEY GEMINI_LIVE_MODEL GEMINI_LIVE_VOICE PROBE_GEMINI_VOICE \
           VOICE_AGENT_PROVIDER VOICE_CALL_PROVIDER DEFAULT_VOICE_CAMPAIGN_LANGUAGE \
           BLOB_READ_WRITE_TOKEN \
           NEXT_PUBLIC_POSTHOG_KEY NEXT_PUBLIC_POSTHOG_HOST POSTHOG_API_KEY POSTHOG_HOST \
           SLACK_SIGNING_SECRET TRACKING_BASE_URL TRACKING_SECRET \
           NEXT_PUBLIC_DISABLED_FEATURES MAX_DATASETS_PER_USER; do
  val="${!var}"
  if [ -n "$val" ]; then
    echo "$var=$val" >> "$ENV_LOCAL"
  fi
done
echo "Wrote $(wc -l < "$ENV_LOCAL") variables to .env.local"

PARQUET_FILE="/app/data/parquet/events.parquet"
PARQUET_URL="https://storage.googleapis.com/gc-prod-demoset/parquet/events.parquet"
DB_FILE="/app/data/ecommerce.duckdb"

# ── Schema versioning ──────────────────────────────────────────────────────
# Bump these when setup scripts change (new tables, altered columns, etc.).
# Mismatched version → DB is deleted and rebuilt from source data.
ECOMMERCE_SCHEMA_VERSION="1"
QUICKHELP_SCHEMA_VERSION="2"

# Log volume state on every boot
echo "=== Volume state at /app/data ==="
ls -lh /app/data 2>/dev/null || echo "(empty or not mounted)"
echo "=================================="

# Download parquet if missing (skipped on warm boots when volume is mounted)
if [ ! -f "$PARQUET_FILE" ]; then
  echo "Parquet file not found. Downloading from GCS..."
  mkdir -p /app/data/parquet
  curl -L --retry 3 --retry-delay 5 "$PARQUET_URL" -o "$PARQUET_FILE"
  echo "Download complete."
else
  echo "Parquet file found on volume — skipping download."
fi

# Clean up any leftover DuckDB temp directory from a previous OOM kill.
# DuckDB creates <db>.tmp/ during operations; if the container is killed mid-query,
# the directory persists and can confuse DuckDB on next open.
DB_TMP="${DB_FILE}.tmp"
if [ -d "$DB_TMP" ]; then
  echo "Removing stale DuckDB temp directory: $DB_TMP"
  rm -rf "$DB_TMP"
fi

# Run DB setup if duckdb file missing or schema version changed
ECOMMERCE_VERSION_FILE="/app/data/.ecommerce-schema-v${ECOMMERCE_SCHEMA_VERSION}"
if [ ! -f "$DB_FILE" ] || [ ! -f "$ECOMMERCE_VERSION_FILE" ]; then
  if [ -f "$DB_FILE" ] && [ ! -f "$ECOMMERCE_VERSION_FILE" ]; then
    echo "Ecommerce schema version changed — rebuilding database..."
    rm -f "$DB_FILE" "${DB_FILE}.wal" /app/data/.ecommerce-schema-v*
  else
    echo "Database not found. Running setup (this may take several minutes)..."
  fi
  cd /app
  npx tsx scripts/setup-data.ts
  touch "$ECOMMERCE_VERSION_FILE"
  echo "Setup complete."
else
  echo "Database found on volume (schema v${ECOMMERCE_SCHEMA_VERSION}) — skipping setup."
  # Remove any stale WAL file left by a dirty process exit.
  rm -f "${DB_FILE}.wal"
fi

QUICKHELP_DB="/app/data/quickhelp.duckdb"
QUICKHELP_CSV_DIR="/app/data/csv"
QUICKHELP_GCS_BASE="https://storage.googleapis.com/gc-prod-demoset/csv"

# Clean up any leftover QuickHelp DuckDB temp directory from a previous OOM kill.
QUICKHELP_TMP="${QUICKHELP_DB}.tmp"
if [ -d "$QUICKHELP_TMP" ]; then
  echo "Removing stale QuickHelp DuckDB temp directory: $QUICKHELP_TMP"
  rm -rf "$QUICKHELP_TMP"
fi

# All 17 CSVs required by setup-quickhelp.ts
QUICKHELP_CSVS=(
  bookings.csv
  customers.csv
  campaigns_v2.csv
  partner_shifts.csv
  journeys.csv
  comms_sends.csv
  ad_campaigns.csv
  ad_sets.csv
  ad_creatives.csv
  ad_daily_metrics.csv
  install_attribution.csv
  booking_unit_economics.csv
  partner_payouts.csv
  funnel_events.csv
  daily_sessions.csv
  referrals.csv
  survey_responses.csv
)

# Always ensure CSV files exist (views read them lazily at query time)
echo "Checking ${#QUICKHELP_CSVS[@]} QuickHelp CSV files..."
mkdir -p "$QUICKHELP_CSV_DIR"
CSVS_DOWNLOADED=0
CSVS_FAILED=0
for csv in "${QUICKHELP_CSVS[@]}"; do
  if [ ! -s "$QUICKHELP_CSV_DIR/$csv" ]; then
    echo "  Downloading $csv..."
    if curl -fL --retry 3 --retry-delay 5 "$QUICKHELP_GCS_BASE/$csv" -o "$QUICKHELP_CSV_DIR/$csv" 2>/dev/null; then
      CSVS_DOWNLOADED=$((CSVS_DOWNLOADED + 1))
    else
      echo "  WARNING: Failed to download $csv"
      rm -f "$QUICKHELP_CSV_DIR/$csv"  # Remove partial/empty file
      CSVS_FAILED=$((CSVS_FAILED + 1))
    fi
  fi
done
if [ "$CSVS_FAILED" -gt 0 ]; then
  echo "ERROR: $CSVS_FAILED CSV files failed to download. Cannot start."
  exit 1
elif [ "$CSVS_DOWNLOADED" -gt 0 ]; then
  echo "Downloaded $CSVS_DOWNLOADED CSV files."
else
  echo "All CSV files present."
fi

# Build QuickHelp DB if missing or schema version changed
QUICKHELP_VERSION_FILE="/app/data/.quickhelp-schema-v${QUICKHELP_SCHEMA_VERSION}"
if [ ! -f "$QUICKHELP_DB" ] || [ ! -f "$QUICKHELP_VERSION_FILE" ]; then
  if [ -f "$QUICKHELP_DB" ] && [ ! -f "$QUICKHELP_VERSION_FILE" ]; then
    echo "QuickHelp schema version changed — rebuilding database..."
    rm -f "$QUICKHELP_DB" "${QUICKHELP_DB}.wal" /app/data/.quickhelp-schema-v*
  else
    echo "QuickHelp database not found. Running setup..."
  fi
  cd /app
  npx tsx scripts/setup-quickhelp.ts
  touch "$QUICKHELP_VERSION_FILE"
  echo "QuickHelp setup complete."
else
  echo "QuickHelp database found on volume (schema v${QUICKHELP_SCHEMA_VERSION}) — skipping setup."
  # Remove any stale WAL file left by a dirty process exit.
  rm -f "${QUICKHELP_DB}.wal"
fi

GAMERAMP_SCHEMA_VERSION="1"
GAMERAMP_DB="/app/data/gameramp.duckdb"
GAMERAMP_PARQUET_DIR="/app/data/parquet/gamerampv2"
GAMERAMP_GCS_BASE="https://storage.googleapis.com/gc-prod-demoset/parquet/gamerampv2"

# Clean up any leftover DuckDB temp directory from a previous OOM kill.
GAMERAMP_TMP="${GAMERAMP_DB}.tmp"
if [ -d "$GAMERAMP_TMP" ]; then
  echo "Removing stale GamerRamp DuckDB temp directory: $GAMERAMP_TMP"
  rm -rf "$GAMERAMP_TMP"
fi

# Download all 5 parquet files (skipped on warm boots when volume is mounted)
GAMERAMP_PARQUETS=(installs sessions ad_impression_events revenue campaign)
echo "Checking ${#GAMERAMP_PARQUETS[@]} GamerRamp parquet files..."
mkdir -p "$GAMERAMP_PARQUET_DIR"
GAMERAMP_FAILED=0
for p in "${GAMERAMP_PARQUETS[@]}"; do
  if [ ! -s "$GAMERAMP_PARQUET_DIR/$p.parquet" ]; then
    echo "  Downloading $p.parquet..."
    if curl -fL --retry 3 --retry-delay 5 "$GAMERAMP_GCS_BASE/$p.parquet" -o "$GAMERAMP_PARQUET_DIR/$p.parquet" 2>/dev/null; then
      echo "  ✓ $p.parquet"
    else
      echo "  ERROR: Failed to download $p.parquet"
      rm -f "$GAMERAMP_PARQUET_DIR/$p.parquet"
      GAMERAMP_FAILED=$((GAMERAMP_FAILED + 1))
    fi
  fi
done
if [ "$GAMERAMP_FAILED" -gt 0 ]; then
  echo "ERROR: $GAMERAMP_FAILED GamerRamp parquet files failed to download. Cannot start."
  exit 1
fi
echo "All GamerRamp parquet files present."

# Build GamerRamp DB if missing or schema version changed
GAMERAMP_VERSION_FILE="/app/data/.gameramp-schema-v${GAMERAMP_SCHEMA_VERSION}"
if [ ! -f "$GAMERAMP_DB" ] || [ ! -f "$GAMERAMP_VERSION_FILE" ]; then
  if [ -f "$GAMERAMP_DB" ] && [ ! -f "$GAMERAMP_VERSION_FILE" ]; then
    echo "GamerRamp schema version changed — rebuilding database..."
    rm -f "$GAMERAMP_DB" "${GAMERAMP_DB}.wal" /app/data/.gameramp-schema-v*
  else
    echo "GamerRamp database not found. Running setup..."
  fi
  cd /app
  npx tsx scripts/setup-gameramp.ts
  touch "$GAMERAMP_VERSION_FILE"
  echo "GamerRamp setup complete."
else
  echo "GamerRamp database found on volume (schema v${GAMERAMP_SCHEMA_VERSION}) — skipping setup."
  rm -f "${GAMERAMP_DB}.wal"
fi

VASTU_SCHEMA_VERSION="2"
VASTU_DB="/app/data/vastu-hfc.duckdb"
VASTU_CSV_DIR="/app/data/csv/vastu-hfc"

# Clean up any leftover DuckDB temp directory from a previous OOM kill.
VASTU_TMP="${VASTU_DB}.tmp"
if [ -d "$VASTU_TMP" ]; then
  echo "Removing stale Vastu HFC DuckDB temp directory: $VASTU_TMP"
  rm -rf "$VASTU_TMP"
fi

# Generate CSVs if missing (synthetic data — no download needed)
VASTU_CSV_SENTINEL="$VASTU_CSV_DIR/.generated"
if [ ! -f "$VASTU_CSV_SENTINEL" ]; then
  echo "Vastu HFC CSV files not found. Generating (~1.8M rows, this takes a few minutes)..."
  mkdir -p "$VASTU_CSV_DIR"
  cd /app
  NODE_OPTIONS='--max-old-space-size=8192' npx tsx scripts/generate-vastu-hfc.ts
  touch "$VASTU_CSV_SENTINEL"
  echo "Vastu HFC CSV generation complete."
else
  echo "Vastu HFC CSV files found on volume — skipping generation."
fi

# Build Vastu HFC DB if missing or schema version changed
VASTU_VERSION_FILE="/app/data/.vastu-hfc-schema-v${VASTU_SCHEMA_VERSION}"
if [ ! -f "$VASTU_DB" ] || [ ! -f "$VASTU_VERSION_FILE" ]; then
  if [ -f "$VASTU_DB" ] && [ ! -f "$VASTU_VERSION_FILE" ]; then
    echo "Vastu HFC schema version changed — rebuilding database..."
    rm -f "$VASTU_DB" "${VASTU_DB}.wal" /app/data/.vastu-hfc-schema-v* "$VASTU_CSV_SENTINEL"
  else
    echo "Vastu HFC database not found. Running setup..."
  fi
  cd /app
  npx tsx scripts/setup-vastu-hfc.ts
  touch "$VASTU_VERSION_FILE"
  echo "Vastu HFC setup complete."
else
  echo "Vastu HFC database found on volume (schema v${VASTU_SCHEMA_VERSION}) — skipping setup."
  rm -f "${VASTU_DB}.wal"
fi

FUNDSINDIA_SCHEMA_VERSION="1"
FUNDSINDIA_DB="/app/data/fundsindia.duckdb"
FUNDSINDIA_CSV_DIR="/app/data/csv/fundsindia"
FUNDSINDIA_CSV_SENTINEL="$FUNDSINDIA_CSV_DIR/.generated"

# Clean up any leftover DuckDB temp directory from a previous OOM kill.
FUNDSINDIA_TMP="${FUNDSINDIA_DB}.tmp"
if [ -d "$FUNDSINDIA_TMP" ]; then
  echo "Removing stale FundsIndia DuckDB temp directory: $FUNDSINDIA_TMP"
  rm -rf "$FUNDSINDIA_TMP"
fi

# Generate CSVs if missing (deterministic seed=42, ~2 min, ~265 MB)
if [ ! -f "$FUNDSINDIA_CSV_SENTINEL" ]; then
  echo "FundsIndia CSV files not found. Generating (~2.1M rows, this takes ~2 minutes)..."
  mkdir -p "$FUNDSINDIA_CSV_DIR"
  cd /app
  NODE_OPTIONS='--max-old-space-size=8192' npx tsx scripts/generate-fundsindia.ts
  touch "$FUNDSINDIA_CSV_SENTINEL"
  echo "FundsIndia CSV generation complete."
else
  echo "FundsIndia CSV files found on volume — skipping generation."
fi

# Build FundsIndia DB if missing or schema version changed
FUNDSINDIA_VERSION_FILE="/app/data/.fundsindia-schema-v${FUNDSINDIA_SCHEMA_VERSION}"
if [ ! -f "$FUNDSINDIA_DB" ] || [ ! -f "$FUNDSINDIA_VERSION_FILE" ]; then
  if [ -f "$FUNDSINDIA_DB" ] && [ ! -f "$FUNDSINDIA_VERSION_FILE" ]; then
    echo "FundsIndia schema version changed — rebuilding database..."
    rm -f "$FUNDSINDIA_DB" "${FUNDSINDIA_DB}.wal" /app/data/.fundsindia-schema-v* "$FUNDSINDIA_CSV_SENTINEL"
    # Re-generate CSVs since sentinel was removed
    echo "Re-generating FundsIndia CSVs..."
    mkdir -p "$FUNDSINDIA_CSV_DIR"
    cd /app
    NODE_OPTIONS='--max-old-space-size=8192' npx tsx scripts/generate-fundsindia.ts
    touch "$FUNDSINDIA_CSV_SENTINEL"
  else
    echo "FundsIndia database not found. Running setup..."
  fi
  cd /app
  npx tsx scripts/setup-fundsindia.ts
  touch "$FUNDSINDIA_VERSION_FILE"
  # CSVs no longer needed — DuckDB is fully self-contained (all tables materialized).
  # Delete to reclaim ~265 MB on the volume.
  echo "Cleaning up FundsIndia CSVs (DuckDB is self-contained)..."
  rm -rf "$FUNDSINDIA_CSV_DIR"
  echo "FundsIndia setup complete."
else
  echo "FundsIndia database found on volume (schema v${FUNDSINDIA_SCHEMA_VERSION}) — skipping setup."
  rm -f "${FUNDSINDIA_DB}.wal"
fi

HEALTHIANS_SCHEMA_VERSION="1"
HEALTHIANS_DB="/app/data/healthians.duckdb"
HEALTHIANS_CSV_DIR="/app/data/csv/healthians"
HEALTHIANS_CSV_SENTINEL="$HEALTHIANS_CSV_DIR/.generated"

# Clean up any leftover DuckDB temp directory from a previous OOM kill.
HEALTHIANS_TMP="${HEALTHIANS_DB}.tmp"
if [ -d "$HEALTHIANS_TMP" ]; then
  echo "Removing stale Healthians DuckDB temp directory: $HEALTHIANS_TMP"
  rm -rf "$HEALTHIANS_TMP"
fi

# Generate CSVs if missing (deterministic seed=42, ~7-10 min, ~1.2 GB)
if [ ! -f "$HEALTHIANS_CSV_SENTINEL" ]; then
  echo "Healthians CSV files not found. Generating (~10.2M rows, this takes ~7-10 minutes)..."
  mkdir -p "$HEALTHIANS_CSV_DIR"
  cd /app
  NODE_OPTIONS='--max-old-space-size=8192' npx tsx scripts/generate-healthians.ts
  touch "$HEALTHIANS_CSV_SENTINEL"
  echo "Healthians CSV generation complete."
else
  echo "Healthians CSV files found on volume — skipping generation."
fi

# Build Healthians DB if missing or schema version changed
HEALTHIANS_VERSION_FILE="/app/data/.healthians-schema-v${HEALTHIANS_SCHEMA_VERSION}"
if [ ! -f "$HEALTHIANS_DB" ] || [ ! -f "$HEALTHIANS_VERSION_FILE" ]; then
  if [ -f "$HEALTHIANS_DB" ] && [ ! -f "$HEALTHIANS_VERSION_FILE" ]; then
    echo "Healthians schema version changed — rebuilding database..."
    rm -f "$HEALTHIANS_DB" "${HEALTHIANS_DB}.wal" /app/data/.healthians-schema-v* "$HEALTHIANS_CSV_SENTINEL"
    # Re-generate CSVs since sentinel was removed
    echo "Re-generating Healthians CSVs..."
    mkdir -p "$HEALTHIANS_CSV_DIR"
    cd /app
    NODE_OPTIONS='--max-old-space-size=8192' npx tsx scripts/generate-healthians.ts
    touch "$HEALTHIANS_CSV_SENTINEL"
  else
    echo "Healthians database not found. Running setup..."
  fi
  cd /app
  npx tsx scripts/setup-healthians.ts
  touch "$HEALTHIANS_VERSION_FILE"
  # CSVs no longer needed — DuckDB is fully self-contained (all tables materialized).
  # Delete to reclaim ~1.2 GB on the volume.
  echo "Cleaning up Healthians CSVs (DuckDB is self-contained)..."
  rm -rf "$HEALTHIANS_CSV_DIR"
  echo "Healthians setup complete."
else
  echo "Healthians database found on volume (schema v${HEALTHIANS_SCHEMA_VERSION}) — skipping setup."
  rm -f "${HEALTHIANS_DB}.wal"
fi

echo "Starting app..."
export NODE_ENV=production
exec pnpm start
