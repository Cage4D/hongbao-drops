#!/usr/bin/env bash
# Generate production secrets into a private file (never printed, never committed).
# Usage: scripts/gen-prod-secrets.sh   → then copy each line into Vercel → Settings → Environment Variables.
set -euo pipefail
OUT="${1:-$HOME/.local/share/hongbao-drops/prod-secrets.env}"
mkdir -p "$(dirname "$OUT")"
if [ -e "$OUT" ]; then echo "$OUT already exists — not overwriting (delete it yourself to regenerate)."; exit 1; fi
umask 077
KEEPER="$(openssl rand -hex 24)"
{
  echo "GATE_MASTER_SEED=$(openssl rand -hex 32)"
  echo "ADMIN_TOKEN=$(openssl rand -hex 24)"
  echo "KEEPER_TOKEN=$KEEPER"
  echo "CRON_SECRET=$KEEPER"
} > "$OUT"
echo "Wrote $OUT (mode 600) with: GATE_MASTER_SEED, ADMIN_TOKEN, KEEPER_TOKEN, CRON_SECRET"
