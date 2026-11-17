# Phase 8 — Deploy & mainnet (in progress)

## Deployment (Chipnet), 2026-11-17

**Production URL: https://hongbao-drops-api.vercel.app** · Vercel project `hongbao-drops-api` (root `apps/api`, Node 24, NestJS zero-config), Neon Postgres via the Vercel Marketplace.

- **Settings:** Vercel Authentication is limited to **preview** deployments. The team default (`all_except_custom_domains`) would have put a login in front of the public API, wallets fetching BCMR, and the keeper cron.
- **Secrets** (`GATE_MASTER_SEED`, `ADMIN_TOKEN`, `KEEPER_TOKEN` = `CRON_SECRET`) were generated locally with `scripts/gen-prod-secrets.sh` and set by the builder. They never passed through the agent.
- **Migrations** run in the build (`prisma migrate deploy`, using Neon's `DATABASE_URL_UNPOOLED`).

### Getting the build green (5 builds)

| Build | Failure | Fix |
|---|---|---|
| 1 | `functions` pattern `src/app.ts` "doesn't match" | Zero-config NestJS doesn't support a `functions`/`includeFiles` block. Dropped it; fonts are now **embedded at build time** as generated modules (`tools/embed-fonts.mjs`) and written to `/tmp` on first use |
| 2 | "No entrypoint found which imports nestjs" | `src/app.ts` now calls `NestFactory.create` directly; shared setup moved to `configureApp()` |
| 3 | TS2339 `Response.json` | Vercel type-checks with a different ambient `Response`, so parse via `text()` |
| 4 | TS2339 `result.reasons` | Vercel type-checks **without strict mode**, so `!result.ok` doesn't narrow. Reproduced locally with `tsc --strict false` (only error) and switched to `'reasons' in result` |
| 5 | ✅ READY | |

### Production checks on Chipnet

| Check | Result |
|---|---|
| `GET /health` | 200: db ✅, Fulcrum over WSS from Vercel ✅ (`chipnet.bch.ninja`), price ✅ |
| `api-e2e` against production | create → `NOT_FUNDED` → wrong-envelope `FUNDING_MISMATCH` → `ACTIVE` ([62d1ea53…](https://chipnet.imaginary.cash/tx/62d1ea5353dd3dff0c24f16898701d201bf1a89afba7fd595f00f8a6b6e8b31d)) |
| `claims-e2e` against production | 3 parallel stamped claims (fresh wallets, `isNewWallet=true`), `ENVELOPE_EMPTY`, `ALREADY_CLAIMED`, hold + quiz ✅ |
| `GET /og/:slug.png` on Vercel | 1200×630, fonts render, ~1.7 s cold |
| `GET /stamps/…png`, `GET /bcmr/…json` | 200. **Served registry sha256 `631e9f0e…` = the hash in the funding tx's OP_RETURN**, and the URI points at the production domain |
| Stamp sent to the builder's Paytaca (Chipnet) | Delivered on-chain ([c79ec71c…](https://chipnet.imaginary.cash/tx/c79ec71cb330fc8b3a4efa6567aedf3110b03b60ebc948217339fd98d28449e9)), but **not visible in Paytaca's Chipnet view**, see below |

### Finding: Paytaca on Chipnet shows different addresses than it exposes over WizardConnect

The xpub Paytaca shares over WizardConnect derives `bchtest:qqxcan93…tvrz`. Paytaca's own Chipnet screen shows a **different** receive address (confirmed by the builder). Most likely the WizardConnect xpub is the coin-type-145 (mainnet) path, while the Chipnet wallet view uses coin type 1.

- Coins and stamps sent to the WizardConnect addresses are safe (Paytaca signed spends from them in Phase 2), just **invisible in the app on Chipnet**.
- On **mainnet** both use coin type 145, so they should agree. **The wallet metadata check (stamp name/image in Paytaca) moves to the first mainnet envelope (Nov 19).**
- **Note for the frontend session:** don't rely on Chipnet + Paytaca for any "see it in your wallet" demo.

## Still to do

- **Keeper scheduler (builder):** cron-job.org → `POST /internal/keeper/tick` every minute with `Authorization: Bearer KEEPER_TOKEN`. Verify via `/health` → `keeper.lastRunAt`. The daily Vercel Cron backstop is configured.
- **Mainnet switch on Nov 19** (day 6, spec §10.1):
  1. A dedicated demo wallet funded with ≤ $5.
  2. `NETWORK=MAINNET`, mainnet `FULCRUM_URLS` and `TREASURY_ADDRESS`, **new** `GATE_MASTER_SEED` and a fresh database (Chipnet envelope sequence numbers must not mix with mainnet gate keys).
  3. Tiny funding, claim and batch-refund txids; `/admin/budget` < $1 spent.
  4. Paytaca stamp check on mainnet.
