# Phase 8 — mainnet switch runbook (Nov 19)

Prepared 2026-11-17 with no mainnet spend. **Every step that moves real BCH is marked 💸, and Claude asks before each one.**

## Budget: $3 (builder's decision, 2026-11-17)

At ~$213/BCH, $3 ≈ **1,410,000 sats**. The server cap is set **below** what the wallet holds: **`BUDGET_TOTAL_USD=2.5`**. The API then stops with its own `BUDGET_CAP` message while ~$0.50 is still in the wallet, which covers funding/prep tx fees and BCH price swings, instead of a funding attempt failing for lack of coins. Only envelopes refunding to the demo wallet count (review-2 Q1).

| Use | USD | Notes |
|---|---|---|
| Nov 19 checks | ≤ $0.05 | One 2-share seal-bearing envelope of 4,000 sats: one share to your Paytaca, one refunded. Fees ≈ $0.003 |
| Judges' demo envelopes | $1.10 | Refilled one at a time via `/admin/demo/refill` |
| "BLAZE Drop" campaign (Phase 9) | $0.90 | |
| Buffer inside the cap | ≈ $0.45 | |
| Margin outside the cap | ≈ $0.50 | Network fees and price moves; the API never commits it |

Default caps stay: `MAX_ENVELOPE_USD` 0.50, `MAX_SHARES` 10, `MAX_ACTIVE_MAINNET_SATS` 600,000 (≈ $1.28), `DAILY_MAINNET_SATS` 400,000 (≈ $0.85/day), max expiry 24 h.

## Prepared (done)

| Item | Value |
|---|---|
| Demo wallet (fund this, ≈ $3) | `bitcoincash:qr2e5eeur56d4qatra9fsxn230g4v2tsrujqjznd3p` |
| Treasury (identity outputs + sponsor fees; never spent) | `bitcoincash:qzrxax7vr0cw0s3ptldqj8302mwnfgeg4uayplk6rf` |
| Keys | `scripts/.state/mainnet/{wallet,treasury}.json`, mode 600, gitignored. **Back this folder up**: it's the only copy |
| Scripts | `--mainnet` works only for `wallet`, `inspect`, `addr-check`, `send`, `seal-to-wallet`. Broadcasting also needs `--yes-mainnet`. `send` is capped at 50,000 sats, `seal-to-wallet` at 20,000. Every e2e suite refuses mainnet |
| Fulcrum (probed 2026-11-17) | `bch.imaginary.cash:50004` ✅, `fulcrum.greyh.at:50004` ✅ (both with `get_history`, same tip). The API refuses hosts on the wrong network (review-2 P1-5) |

## Nov 19 steps

### 1. Fund the demo wallet (builder) 💸
Send ≈ $3 from your own wallet to the demo wallet address above. Check:
```bash
pnpm --filter @hongbao/scripts wallet -- --mainnet
```

### 2. New secrets for mainnet (builder)
```bash
scripts/gen-prod-secrets.sh ~/.local/share/hongbao-drops/mainnet-secrets.env
```
A new `GATE_MASTER_SEED` is required (Chipnet envelope sequence numbers must not mix with mainnet gate keys). The tokens are rotated along with it.

### 3. Fresh database (builder, Neon console)
Recommended: in the Neon console, **create a branch `chipnet-archive`** from the production branch (it keeps the Chipnet history), then empty the production branch in its SQL editor:
```sql
TRUNCATE "Event", "RateEvent", "Claim", "Share", "Envelope", "Campaign", "Sponsor", "LedgerEntry", "Setting" RESTART IDENTITY CASCADE;
```
The env vars (`DATABASE_URL`, …) stay the same. Migrations are already applied. ⚠️ After this, production no longer has the Chipnet envelopes the frontend session may be testing with.

### 4. Vercel env (Production), then redeploy (builder)
| Var | Value |
|---|---|
| `NETWORK` | `MAINNET` |
| `TREASURY_ADDRESS` | `bitcoincash:qzrxax7vr0cw0s3ptldqj8302mwnfgeg4uayplk6rf` |
| `BUDGET_WALLET_ADDRESS` | `bitcoincash:qr2e5eeur56d4qatra9fsxn230g4v2tsrujqjznd3p` |
| `BUDGET_TOTAL_USD` | `2.5` (below the wallet's ~$3 on purpose) |
| `FULCRUM_URLS` | `wss://bch.imaginary.cash:50004,wss://fulcrum.greyh.at:50004` |
| `GATE_MASTER_SEED`, `ADMIN_TOKEN`, `KEEPER_TOKEN`, `CRON_SECRET` | from `mainnet-secrets.env` |
| `PUBLIC_API_URL`, `CLIENT_IP_HEADER` | unchanged (`https://hongbao-drops-api.vercel.app`, `x-forwarded-for`) |

Env changes need a redeploy (Vercel → Deployments → Redeploy). The API **refuses to start** if `BUDGET_WALLET_ADDRESS` is missing or `PUBLIC_API_URL` isn't public https.

### 5. Point the keeper cron at the new token (Claude)
```bash
scripts/setup-keeper-cron.sh --secrets ~/.local/share/hongbao-drops/mainnet-secrets.env
scripts/setup-keeper-cron.sh --status
```
Then `/health` should show `"network":"MAINNET"`, a mainnet server, and a fresh `keeper.lastRunAt`.

### 6. Caps on the live URL, no spend (Claude)
Each request is refused before anything is created: `shareCount: 11` → 422 `MAX_SHARES`; `totalSats: 300000` → 422 `MAX_ENVELOPE_USD`; expiry 25 h → 400. Also `GET /admin/budget` should show `budgetWallet` = the demo wallet, `priceLive: true`, and 0 spent.

### 7. First real envelope: funding + claim to Paytaca + batch refund (Claude, after asking) 💸
```bash
pnpm --filter @hongbao/scripts seal-to-wallet -- --mainnet --yes-mainnet \
  --to <your Paytaca mainnet address> --api https://hongbao-drops-api.vercel.app \
  --shares 2 --sats 4000 --expiry-minutes 15
```
- **Funding tx:** 2 seal-bearing shares, BCMR publication, identity output to the treasury.
- **Claim tx:** about 1,500 sats + seal to your Paytaca. **Check in Paytaca:** the sats arrive, a collectible appears, and the name and image show up. This is the check Chipnet couldn't do.
- **This is a must-pass gate: Paytaca is a hackathon sponsor and the required wallet.** If any part fails, stop and diagnose before anything else:
  1. Compare Paytaca's server with the chain: `https://watchtower.cash/api/balance/bch/<addr>/` and `/api/utxo/bch/<addr>/` vs `addr-check --mainnet <addr>`.
  2. For a missing name/image: check whether Paytaca's metadata indexer knows the seal, at `https://bcmr.paytaca.com/api/tokens/<category>/`. If not, compare our registry and OP_RETURN with a token that does display in Paytaca.
  3. Ask the Paytaca team (sponsor channel). They can tell us what their indexer expects.
- **Refund tx:** the keeper batch-refunds the other share to the demo wallet about 75 min later (15 min expiry + about 1 h median-time-past lag).
- Total cost about 2,000 sats claimed + about 1,500 sats of fees ≈ **$0.008**.

### 8. Budget check (Claude)
`GET /admin/budget`: claimed ≈ 2,000 sats, under $1 spent, ledger matches state. Record all txids in `phase8-deploy.md`.

### 9. Judges' demo envelope (needs the frontend URL)
The share link is `https://<frontend>/e/<id>#k=<link secret>`, so it can only be made once the frontend's URL is known. Plan: a small `demo-envelope` script (mainnet-allowed, `--yes-mainnet`) that creates and funds via the API from the demo wallet, prints the share link, and registers it with `POST /admin/demo/refill`. Built when the frontend URL exists.

### 10. Phase 8 report → your approval → tag `phase-8` + push.

## If something goes wrong
- **Paytaca shows nothing:** compare Paytaca's server with the chain, as on Chipnet (`watchtower.cash/api/balance/bch/<addr>/` vs `addr-check --mainnet`).
- **Back to Chipnet:** restore the Chipnet env values (they're in `prod-secrets.env` and the current Vercel config), point `DATABASE_URL` at the `chipnet-archive` branch, redeploy, then `setup-keeper-cron.sh` with the Chipnet secrets.
- **Refund didn't happen:** the keeper retries every minute. Check `/health` → `keeper.lastRunAt` and `setup-keeper-cron.sh --status`. Mainnet refunds open about 1 h after expiry.
