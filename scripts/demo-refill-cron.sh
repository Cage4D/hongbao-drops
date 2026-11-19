#!/usr/bin/env bash
# Keeps the judges' demo envelope ("Try it free") funded on mainnet, unattended.
#
# Safe to run as often as you like (cron every 30 min, and once at Windows logon): it only spends
# when the current demo envelope is used up, expired, or has under REFILL_BELOW_SECONDS left, so in
# practice it refills about once a day. Each refill is one demo-envelope run (10 x 5,000 sats ≈ $0.10;
# unclaimed shares return to the demo wallet at expiry). The wallet key never leaves this machine.
#
# Stops for good after STOP_AFTER (end of judging), and when the demo wallet runs low
# (demo-envelope refuses to fund without enough coins).
# Log: ~/.local/share/hongbao-drops/refill.log
set -uo pipefail

REPO="/home/cage4d/Codebase/hongbao-drops"
API="https://hongbao-drops-api.vercel.app"
REFILL_BELOW_SECONDS=10800          # refill when under 3 h are left
STOP_AFTER="2026-12-01T00:00:00Z"   # no automatic spending after this
LOG_DIR="$HOME/.local/share/hongbao-drops"
LOG="$LOG_DIR/refill.log"
NODE_BIN="/home/cage4d/.nvm/versions/node/v24.21.0/bin"
export PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin"

mkdir -p "$LOG_DIR"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

# One run at a time (cron and the logon task can overlap).
exec 9>"$LOG_DIR/refill.lock"
flock -n 9 || exit 0

if [ "$(date -u +%s)" -ge "$(date -u -d "$STOP_AFTER" +%s)" ]; then
  log "past $STOP_AFTER: automatic refills are off"
  exit 0
fi

demo="$(curl -s -m 20 "$API/demo")" || { log "API unreachable, will retry next run"; exit 0; }
decision="$(printf '%s' "$demo" | node -e '
  let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
    try {
      const d = JSON.parse(s);
      const due = !d.slug || d.sharesLeft === 0 || d.secondsLeft < Number(process.argv[1]);
      console.log(due ? `due ${d.slug ?? "none"} ${d.sharesLeft}/${d.sharesTotal} ${d.secondsLeft}s` : `ok ${d.slug} ${d.sharesLeft}/${d.sharesTotal} ${d.secondsLeft}s`);
    } catch { console.log("bad-response"); }
  });' "$REFILL_BELOW_SECONDS")"

case "$decision" in
  ok*) exit 0 ;;   # nothing to do; stay quiet so the log only shows refills
  bad-response) log "unexpected /demo response, will retry next run"; exit 0 ;;
esac

# After a failed attempt, wait before trying again: a run that fails AFTER broadcasting the funding
# tx (it happened once, 2026-11-18) must not be repeated every 30 minutes.
FAIL_STAMP="$LOG_DIR/refill.last-failure"
if [ -f "$FAIL_STAMP" ] && [ $(( $(date -u +%s) - $(cat "$FAIL_STAMP") )) -lt 21600 ]; then
  exit 0
fi

log "refill due ($decision): funding a new demo envelope"
cd "$REPO" || { log "repo not found at $REPO"; exit 1; }
if pnpm --filter @hongbao/scripts demo-envelope -- --mainnet --yes-mainnet 2>&1 \
    | sed -E 's/#k=[A-Za-z0-9]+/#k=…/g' >> "$LOG"; then
  rm -f "$FAIL_STAMP"
  log "refill done"
else
  date -u +%s > "$FAIL_STAMP"
  log "refill FAILED (see above); pausing automatic refills for 6 h. Check the demo by hand."
fi
