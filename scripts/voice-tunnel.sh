#!/usr/bin/env bash
# Bring up a fresh public tunnel for voice calls and wire it into .env.local.
#
# WHY THIS EXISTS: Cloudflare "quick tunnels" are free but disposable — they die
# on their own and hand out a brand-new random web address every restart. When
# the tunnel dies, the phone still rings but the call cuts the instant you answer
# (Plivo can't reach the app to get its instructions). This script restarts the
# tunnel, updates the address everywhere it's needed, and restarts the app — in
# one command — so you never have to chase a dead tunnel by hand again.
#
# Usage:  ./scripts/voice-tunnel.sh
# Then:   place a test call from the Voice page.

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
TUNNEL_LOG="/tmp/cf-tunnel.log"
DEV_LOG="/tmp/dev-server.log"
PORT=3000

echo "==> Stopping any old tunnel..."
pkill -f 'cloudflared tunnel' 2>/dev/null && echo "    stopped old tunnel" || echo "    (none running)"

echo "==> Starting a fresh tunnel to localhost:${PORT}..."
rm -f "$TUNNEL_LOG"
nohup cloudflared tunnel --url "http://localhost:${PORT}" > "$TUNNEL_LOG" 2>&1 &
echo "    cloudflared pid $!"

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

echo "==> Restarting the app so it picks up the new address..."
lsof -ti:${PORT} | xargs kill -9 2>/dev/null || true
nohup pnpm dev > "$DEV_LOG" 2>&1 &
echo "    dev server pid $!"

echo "==> Waiting for the app to boot..."
curl -s --retry 60 --retry-delay 1 --retry-connrefused --retry-all-errors -o /dev/null \
  --max-time 120 "http://localhost:${PORT}/api/health"

echo "==> Verifying the phone company can reach the app through the tunnel..."
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${URL}/api/voice/plivo-answer?callId=healthcheck")
if [ "$CODE" = "200" ]; then
  echo ""
  echo "  ALL GOOD — tunnel is live and the call endpoint returns 200."
  echo "  Public address: $URL"
  echo "  Place a test call from the Voice page now."
else
  echo "!! Call endpoint returned HTTP ${CODE} (expected 200). Check ${DEV_LOG}." >&2
  exit 1
fi
