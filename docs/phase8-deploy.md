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

### Chipnet re-test against production, 2026-11-17 (later the same day)

| Check | Result |
|---|---|
| `stamp-to-wallet` to the address **Paytaca's own app shows** (`bchtest:qzzlwz…u9d2v`) | Funding [0d0a2b6a…](https://chipnet.imaginary.cash/tx/0d0a2b6aec810725edff29d025cef4ef210e727f4c793bd8d737a63465f78afe), claim [cf2ab71c…](https://chipnet.imaginary.cash/tx/cf2ab71cb23cc037e69a787cd2bc27f37e03969caaf734a4e7b699d47bd902f3): 4,515 sats + stamp `0600000001`, confirmed in block 334907 |
| Plain 20,000-sat send to the same address (no token) | [ea8ce884…](https://chipnet.imaginary.cash/tx/ea8ce8847759b267b9816927bbebbbb8e44b000454b33476d10d75941d1590b9), confirmed in block 334913 |
| `api-e2e` against production | All checks pass. `ACTIVE` with 3 stamped shares: [ab83af8e…](https://chipnet.imaginary.cash/tx/ab83af8e356f2ce76e28fc98c235e1ef5a4d02c5e28e3a1d3a54747fe9c645dc) |
| `claims-e2e` against production | All checks pass: 3 parallel stamped claims ([731341…](https://chipnet.imaginary.cash/tx/731341188479db33d701a393d4f3c592804a7c5f631f57d606de88574e682042), [f7c3d4…](https://chipnet.imaginary.cash/tx/f7c3d4e2254200e90ef9646e306d2d28a013e018d6ae9d0d763a63596e56a470), [599d6e…](https://chipnet.imaginary.cash/tx/599d6e499cbaf039f58159d780a1586cb2479dd6a18a0f1f5b1a86ce0539b89a)), `ENVELOPE_EMPTY`, `ALREADY_CLAIMED`, hold + quiz ([6d4adf40…](https://chipnet.imaginary.cash/tx/6d4adf40faf24e61dfdb226a307cf9384efb95a5c726d0afac0be9b41a723fe2)) |

**Neither payment appeared in Paytaca, not even the plain BCH.** `scripts addr-check` shows both coins at the address on-chain. The cause is Paytaca's Chipnet backend: `https://chipnet.watchtower.cash/` (root and `/api/status/`) returns **HTTP 502**, while mainnet `https://watchtower.cash/api/status/` returns `{"status": "up"}`. Paytaca reads balances from that backend, so **Paytaca on Chipnet can't show anything right now**, whatever the address. This is outside our stack. The wallet display check stays on mainnet (Nov 19).

Check any Chipnet address yourself: `pnpm --filter @hongbao/scripts addr-check -- bchtest:…`

## Still to do

- **Keeper scheduler (builder):** cron-job.org → `POST /internal/keeper/tick` every minute with `Authorization: Bearer KEEPER_TOKEN`. Verify via `/health` → `keeper.lastRunAt`. The daily Vercel Cron backstop is configured.
- **Mainnet switch on Nov 19** (day 6, spec §10.1):
  1. A dedicated demo wallet funded with ≤ $5.
  2. `NETWORK=MAINNET`, mainnet `FULCRUM_URLS` and `TREASURY_ADDRESS`, **new** `GATE_MASTER_SEED` and a fresh database (Chipnet envelope sequence numbers must not mix with mainnet gate keys).
  3. Tiny funding, claim and batch-refund txids; `/admin/budget` < $1 spent.
  4. Paytaca stamp check on mainnet.
