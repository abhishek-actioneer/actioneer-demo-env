#!/usr/bin/env bash
# Start the voice-biometric analysis service (the "is this really the cardholder?"
# check behind the HDFC fraud demo).
#
# WHY THIS EXISTS: the fraud demo's "🚨 VOICE MISMATCH" alert is produced by a small
# Python service (analysis-service/) that compares the live caller's voice against the
# real cardholder's enrolled voiceprint. If this service isn't running, the call still
# works but the biometric alert never fires. This script starts it on port 8000 (where
# the app expects it) and confirms it's healthy with the cardholders enrolled.
#
# Usage:  ./scripts/biometric-service.sh
# Run this BEFORE a fraud-demo test call. Leave it running for the demo.

set -euo pipefail
cd "$(dirname "$0")/../analysis-service"

VENV=".venv"
PORT=8000
LOG="/tmp/analysis-service.log"

if [ ! -d "$VENV" ]; then
  echo "==> First run: creating Python environment (one-time, a few minutes)..."
  python3 -m venv "$VENV"
  ./"$VENV"/bin/pip install --upgrade pip -r requirements.txt -c <(echo 'transformers==4.44.2')
fi

echo "==> Stopping anything on port ${PORT}..."
lsof -ti:${PORT} | xargs kill -9 2>/dev/null || true

echo "==> Starting the biometric service..."
nohup ./"$VENV"/bin/uvicorn main:app --host 0.0.0.0 --port ${PORT} > "$LOG" 2>&1 &
echo "    pid $!"

echo "==> Waiting for it to be healthy..."
HEALTH=$(curl -s --retry 60 --retry-delay 1 --retry-connrefused --retry-all-errors \
  --max-time 120 "http://localhost:${PORT}/health")
echo "    $HEALTH"

echo "==> Warming the speaker model (so the first call isn't slow)..."
./"$VENV"/bin/python -c "
import warnings; warnings.filterwarnings('ignore')
import numpy as np
from embedder import get_embedding
get_embedding(np.random.randn(8000).astype('float32'), 8000)
print('    model ready')
" 2>/dev/null

echo ""
echo "  BIOMETRIC SERVICE READY on http://localhost:${PORT}"
echo "  Enrolled cardholders are listed in the health line above."
echo "  Now run a fraud-demo Test Call targeting one of those customers."
