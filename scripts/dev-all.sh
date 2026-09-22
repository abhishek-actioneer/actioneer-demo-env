#!/usr/bin/env bash
# One command to bring up the full local voice stack:
#   1. Python analysis-service (FastAPI/uvicorn) on :8000
#   2. A fresh Cloudflare quick-tunnel to :3000, wired into .env.local
#   3. The Next.js app (tsx server.ts) on :3000 — in the FOREGROUND
#
# WHY THE ORDERING MATTERS: the app reads NEXT_PUBLIC_BASE_URL at boot, so the
# tunnel's public address must be written into .env.local BEFORE the server
# starts. Cloudflare quick-tunnels are disposable — they hand out a new random
# address every restart — so we always spin up a fresh one and rewrite the env.
#
# The Next server runs in the foreground so you see its logs; a single Ctrl-C
# tears down the tunnel and the python service too (see the trap below).
#
# Usage:  pnpm dev:all      (or: bash scripts/dev-all.sh)

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
TUNNEL_LOG="/tmp/cf-tunnel.log"
PY_LOG="/tmp/analysis-service.log"
PORT=3000
PY_PORT=8000

TUNNEL_PID=""
PY_PID=""

cleanup() {
  echo ""
  echo "==> Shutting down the voice stack..."
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null && echo "    tunnel stopped" || true
  [ -n "$PY_PID" ] && kill "$PY_PID" 2>/dev/null && echo "    analysis-service stopped" || true
  pkill -f 'cloudflared tunnel' 2>/dev/null || true
  lsof -ti:${PY_PORT} | xargs kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 1. Python analysis-service ---------------------------------------------------
echo "==> Starting analysis-service on :${PY_PORT}..."
lsof -ti:${PY_PORT} | xargs kill 2>/dev/null && echo "    killed old process on :${PY_PORT}" || echo "    (nothing was running)"
rm -f "$PY_LOG"
( cd analysis-service && nohup .venv/bin/uvicorn main:app --host 0.0.0.0 --port ${PY_PORT} > "$PY_LOG" 2>&1 & echo $! > /tmp/analysis-service.pid )
PY_PID=$(cat /tmp/analysis-service.pid)
echo "    analysis-service pid ${PY_PID} (logs: ${PY_LOG})"

# 2. Fresh tunnel + env wiring -------------------------------------------------
echo "==> Stopping any old tunnel..."
pkill -f 'cloudflared tunnel' 2>/dev/null && echo "    stopped old tunnel" || echo "    (none running)"

echo "==> Starting a fresh tunnel to localhost:${PORT}..."
rm -f "$TUNNEL_LOG"
nohup cloudflared tunnel --url "http://localhost:${PORT}" > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
echo "    cloudflared pid ${TUNNEL_PID}"

echo "==> Waiting for the new public address..."
URL=""
for _ in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -n1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "!! Could not detect a tunnel URL. Last log lines:" >&2
  tail -n 20 "$TUNNEL_LOG" >&2
  exit 1
fi
echo "    new address: $URL"

echo "==> Writing the address into ${ENV_FILE}..."
node -e '
const fs = require("fs");
const p = process.argv[1], url = process.argv[2];
let txt = fs.readFileSync(p, "utf8");
fs.writeFileSync(p + ".bak." + Date.now(), txt);
for (const k of ["VOICE_PUBLIC_BASE_URL", "NEXT_PUBLIC_BASE_URL"]) {
  const re = new RegExp("^(?:export\\s+)?" + k + "=.*$", "m");
  txt = re.test(txt) ? txt.replace(re, k + "=" + url) : txt.replace(/\s*$/, "") + "\n" + k + "=" + url + "\n";
}
fs.writeFileSync(p, txt);
console.log("    updated VOICE_PUBLIC_BASE_URL and NEXT_PUBLIC_BASE_URL");
' "$ENV_FILE" "$URL"

# 3. Next.js app (foreground) --------------------------------------------------
echo "==> Freeing port ${PORT}..."
lsof -ti:${PORT} | xargs kill -9 2>/dev/null || true

echo ""
echo "  Tunnel live:      $URL"
echo "  Analysis service: http://localhost:${PY_PORT} (pid ${PY_PID})"
echo "  Starting app in the foreground — Ctrl-C stops everything."
echo ""

pnpm dev
