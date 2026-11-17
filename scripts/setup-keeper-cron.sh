#!/usr/bin/env bash
# Create (or update) the cron-job.org job that runs the keeper every minute:
#   POST <API>/internal/keeper/tick   with   Authorization: Bearer $KEEPER_TOKEN
#
# Secrets are read from files and never printed or put on a command line:
#   - cron-job.org API key:  ~/.local/share/hongbao-drops/cronjob-api-key   (one line)
#   - KEEPER_TOKEN:          ~/.local/share/hongbao-drops/prod-secrets.env  (KEEPER_TOKEN=...)
#
# Usage:
#   scripts/setup-keeper-cron.sh [--api https://hongbao-drops-api.vercel.app]   # create or update
#   scripts/setup-keeper-cron.sh --status                                       # last runs only
set -euo pipefail

DIR="$HOME/.local/share/hongbao-drops"
KEY_FILE="$DIR/cronjob-api-key"
SECRETS="$DIR/prod-secrets.env"
API="https://hongbao-drops-api.vercel.app"
MODE=apply
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API="$2"; shift 2 ;;
    --status) MODE=status; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
TICK_URL="${API%/}/internal/keeper/tick"

[ -s "$KEY_FILE" ] || { echo "Missing $KEY_FILE (cron-job.org API key)." >&2; exit 1; }
CRONJOB_KEY="$(head -n1 "$KEY_FILE" | tr -d '[:space:]')"
export CRONJOB_KEY

# curl with the API key as a header read from a file descriptor, so it never appears in argv.
cj() { # method path [json-on-stdin]
  local method="$1" path="$2"; shift 2
  curl -sS -m 30 -X "$method" "https://api.cron-job.org$path" \
    -H @<(printf 'Authorization: Bearer %s\n' "$CRONJOB_KEY") \
    -H 'Content-Type: application/json' "$@"
}

# Find an existing job for this URL (so re-running updates instead of duplicating).
JOBS="$(cj GET /jobs)"
JOB_ID="$(printf '%s' "$JOBS" | TICK_URL="$TICK_URL" python3 -I -c '
import json, os, sys
try: d = json.load(sys.stdin)
except Exception: sys.exit("cron-job.org: unexpected response to GET /jobs (bad API key or IP not allowed?)")
ids = [j["jobId"] for j in d.get("jobs", []) if j.get("url") == os.environ["TICK_URL"]]
print(ids[0] if ids else "")
')"

if [ "$MODE" = status ]; then
  [ -n "$JOB_ID" ] || { echo "No cron-job.org job for $TICK_URL yet."; exit 1; }
  cj GET "/jobs/$JOB_ID/history" | python3 -I -c '
import json, sys, datetime
d = json.load(sys.stdin)
fmt = lambda t: datetime.datetime.fromtimestamp(t, datetime.UTC).strftime("%H:%M:%S")
print("last runs (UTC, HTTP status, duration):")
for h in d.get("history", [])[:8]:
    print("  %s  %s  %s ms  %s" % (fmt(h["date"]), h.get("httpStatus"), h.get("duration"), h.get("statusText", "")))
print("next:", ", ".join(fmt(t) for t in d.get("predictions", [])))
'
  exit 0
fi

[ -s "$SECRETS" ] || { echo "Missing $SECRETS." >&2; exit 1; }
KEEPER_TOKEN="$(grep '^KEEPER_TOKEN=' "$SECRETS" | cut -d= -f2-)"
[ -n "$KEEPER_TOKEN" ] || { echo "KEEPER_TOKEN not found in $SECRETS." >&2; exit 1; }
export KEEPER_TOKEN

# Job body built from environment variables (never echoed).
BODY="$(TICK_URL="$TICK_URL" python3 -I -c '
import json, os
print(json.dumps({"job": {
    "url": os.environ["TICK_URL"],
    "title": "Hongbao keeper tick",
    "enabled": True,
    "saveResponses": True,        # tick summaries only (refund txids, counts), no secrets
    "requestMethod": 1,           # POST
    "requestTimeout": 30,
    "schedule": {"timezone": "UTC", "expiresAt": 0,
                 "hours": [-1], "mdays": [-1], "minutes": [-1], "months": [-1], "wdays": [-1]},
    "extendedData": {"headers": {"Authorization": "Bearer " + os.environ["KEEPER_TOKEN"]}, "body": ""},
}}))
')"

if [ -n "$JOB_ID" ]; then
  printf '%s' "$BODY" | cj PATCH "/jobs/$JOB_ID" --data-binary @- >/dev/null
  echo "Updated cron-job.org job $JOB_ID: POST $TICK_URL every minute (UTC)."
else
  RES="$(printf '%s' "$BODY" | cj PUT /jobs --data-binary @-)"
  JOB_ID="$(printf '%s' "$RES" | python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("jobId",""))' 2>/dev/null || true)"
  [ -n "$JOB_ID" ] || { echo "cron-job.org did not return a jobId." >&2; exit 1; }
  echo "Created cron-job.org job $JOB_ID: POST $TICK_URL every minute (UTC)."
fi
echo "Check it in ~2 minutes:  scripts/setup-keeper-cron.sh --status   and   curl -s ${API%/}/health"
