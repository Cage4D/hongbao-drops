# Review 2 (phases 5–8, rescan of 1–5): fixes

Like Review 1, this one found no way to take funds, redirect them, refund early or skip the sponsor fee. The contract is unchanged. All findings are fixed inside Phase 8, and every fix has a test that fails on the old code. Totals: **193 tests** (contract 58, shared 4, API 131); before the fixes there were 167.

## Builder decisions (2026-11-17)

| # | Question | Decision |
|---|---|---|
| Q1 | Who do the mainnet totals caps count? | **Only the demo wallet.** `BUDGET_WALLET_ADDRESS` (required on MAINNET). `MAX_ACTIVE_MAINNET_SATS`, `DAILY_MAINNET_SATS`, `BUDGET_TOTAL_USD` and the spend ledger count only envelopes refunding there. `MAX_SHARES`, `MAX_ENVELOPE_USD` and `MAX_ENVELOPE_SATS` still apply to everyone. Judges funding with their own BCH can't use up the $5 or block the demo |
| Q2 | Re-check caps at `/funded`? | **Only for envelopes funded more than 1 h after creation.** Within the hour they were already counted as pending, and a refusal would lock the funder's coins until expiry. Later funding is still re-checked, which keeps review-1 #5's protection |
| Q3 | Max expiry on mainnet | **24 h.** That's the default on MAINNET and also the most allowed. Chipnet keeps 30 days |

## Findings

| # | Sev | Finding | Fix | Test |
|---|---|---|---|---|
| P1-1 | HIGH | Keeper never refunded no-stamp shares under 1,546 sats (dust + maxFee), though the API accepts 1,500. A mixed envelope went `REFUNDED` with small shares left | `planRefund()` (contract package) replaces `refundableUtxos`. It uses the **measured** per-input fee (~340 sat), drops near-dust coins from the batch instead of failing it, and reports what's left over. `buildRefundTx` measures with inflated input values, so CashScript's own fee check can't fire before "too small to refund" (found by the new test). Envelope status now comes from `settle()`, not from the batch | `refund.test.ts` (shares at exactly 1,500 / 2,000; dust left behind; null; >20 batched); `lifecycle › P1-1` (4,500 sats / 3 shares, refunded, `REFUNDED`) |
| P1-2 | HIGH | Envelopes emptied outside the keeper/API stayed `ACTIVE`/`EXPIRED`; `locked` summed `totalSats` of those rows, so 3 of them filled `MAX_ACTIVE_MAINNET_SATS` for good | `settle()` after reconcile and refunds: `EXHAUSTED` (all claimed, emits `exhausted`) or `REFUNDED` once no share is unspent. `locked` = sats of **unspent shares** of funded envelopes (+ pending in their first hour) | `lifecycle › P1-2` ×2 (external refund → `REFUNDED`; last claim broadcast directly → `EXHAUSTED`); `budget › P1-2/P1-3` |
| P1-3 | HIGH | The ledger missed claims recorded by reconcile, so `BUDGET_TOTAL_USD` undercounted. Dropped claims double-counted | Caps and `/admin/budget` derive **spent = CLAIMED share sats** from state, so every path counts. `LedgerEntry` is now an idempotent audit log (per kind + txid + envelope), also written by reconcile (claims and external refunds); a dropped claim's entry is removed. `/admin/budget` shows the ledger next to the state for comparison | `budget › P1-2/P1-3`; `admin › summarises…` (ledger agrees with state) |
| P1-4 | MED | `BUDGET_TOTAL_USD` and the USD caps were skipped when the price was unknown (fresh mainnet DB + CoinGecko failure) | Caps fall back to `BUDGET_FALLBACK_BCH_USD` (default **$500**, ~2.4× today, so strict). `/admin/budget` shows `priceLive` | `budget › P1-4` ×2 |
| P1-5 | MED | Nothing checked that Fulcrum is on the configured network: MAINNET with Chipnet `FULCRUM_URLS` would verify "mainnet" funding with free coins | On connect, `server.features.genesis_hash` must match `NETWORK` or the host is skipped. Hashes were checked live on `chipnet.imaginary.cash`, `chipnet.bch.ninja` and `bch.imaginary.cash`, and a live run of the factory refused MAINNET + Chipnet hosts | `unit › Fulcrum network check` |
| P1-6 | MED | A cap refusal at `/funded` locked real coins until expiry (up to 30 days) | Q2 + Q3 above | `budget › P1-6/Q2`, `budget › Q3` |
| P1-7 | MED | Refunds slowed down with the number of candidates (10 per tick, finished envelopes kept as candidates, MTP waits sent to the back) | MTP first. Waiting envelopes are counted with no chain calls. **Real work first**: never checked since refundable, or unspent shares, up to 20 per tick. Finished contracts get an **hourly sweep**, 3 per tick | `lifecycle › P1-7` (waited for MTP, refunded next tick despite 15 finished envelopes ahead) |
| P1-8 | LOW | Daily Vercel Cron backstop got 404: stacked `@Post`/`@Get` registers only one method. **Confirmed on production** (GET → 404, POST → 401) | Separate GET handler | `lifecycle › P1-8` |
| P1-9 | MED | SSE: no per-IP limit, 1 query/s per viewer; a DB error mid-stream hit the JSON error filter after headers | Opens rate-limited (**30 per IP per 10 min**, about 14 concurrent viewers per IP), poll every 2 s, try/catch ends the stream cleanly | `lifecycle › SSE › P1-9` ×2 |
| P1-10 | LOW | 2 IPs could keep a whole envelope held indefinitely | **2 holds per IP per envelope per 15 min**, and at most **half the shares** (rounded up) held at once. Same-device re-asks return the existing hold without counting | `claims › P1-10`, `claims › #7` (now 2) |
| P1-11 | LOW | Reconcile treated any spend to the sender as a refund | Refund = pays the sender **and** locktime ≥ expiry (refundBatch's CLTV can't pass otherwise); a sender's own claim (locktime 0) is a claim | `lifecycle › P1-11` |
| P1-12 | LOW | Reconcile's `claimed` events lacked `usd`/`luckiest`/`sharesLeft`; no `exhausted` | Same payload as API-relayed claims; `settle()` emits `exhausted` | `lifecycle › P1-2/P1-12` |
| P1-13 | LOW | Pin dropped when another claimer's **unconfirmed** tx took the share, so a stale approval could still win the race and yield two shares | Pin holds while that claim is `BROADCAST`; lifts once `CONFIRMED`. Review-1 #10's test now expects this wait (~10 min on mainnet, ~1 min on Chipnet) | `claims › P1-13`, `lifecycle › #10` |
| P1-14 | LOW | Campaign stats counted `FAILED` envelopes' fees | Campaign stats exclude `FAILED` | `campaigns › P1-14` |
| P1-15 | LOW | No tick time budget; cron-job.org stops at 30 s | Every keeper loop stops at **12 s** (`TICK_BUDGET_MS`), so cold start (~15 s seen) + tick < 30 s. Summary shows `outOfTime` | By construction (all loops rotate by "last checked") |
| P2-1 | LOW | `PUBLIC_API_URL` unchecked on MAINNET (BCMR URIs are committed on-chain forever); `FULCRUM_URLS` ports ignored | MAINNET requires a public `https://` URL. Ports other than 50004 are rejected (CashScript's provider can't use them) | `unit › review-2: mainnet guards` |
| P2-2 | LOW | Anyone can request an approval for someone else's address, pinning it | **Accepted, documented.** The approval pays the owner, so funds are safe. The worst case is the owner waiting until another holder's hold (≤ 15 min) lapses. Approval requests are rate-limited per IP | n/a |
| P2-3 | LOW | `FAILED` envelopes were never refund candidates | Included in the hourly sweep | `lifecycle › P2-3` |
| Review-1 #8 (rest) | | A step > 120 s could outlive the lease | With the 12 s tick budget no step comes near the 120 s lease | n/a |

## Spec items

- **§4 SAME_IP farm flag:** implemented (one IP hash across several claims in a campaign). Claimers sharing a network (venue Wi-Fi, carrier NAT) are flagged too. Flags never block claims; sponsors see the reasons. Worth saying in the pitch for the BLAZE Drop.
- **§9 USD everywhere:** added `totalUsd` on tree nodes and `givenAwayUsd`, `lockedUsd`, `refundedUsd` on campaign stats. These are additions only, so the frontend is unaffected.
- **§10.1 rule 7 (ledger):** now consistent (P1-3). **§10 Vercel Cron backstop:** fixed (P1-8). **§6.4 prompt refunds:** fixed (P1-1, P1-7).

## Test gaps closed

Refunds at minimum share sizes; status and `locked` after external refund or claim; spending after reconcile; price unknown; wrong-network Fulcrum; GET tick; SSE DB error and per-IP limit; CSV formula injection (also now escapes leading tab/CR); a stamped sponsored drop with the fee at the 546-sat floor.

## New / changed config

| Var | Default | Notes |
|---|---|---|
| `BUDGET_WALLET_ADDRESS` | (none) | **Required on MAINNET**: the demo wallet's `bitcoincash:` address |
| `BUDGET_FALLBACK_BCH_USD` | 500 | Price the caps assume when none is known |
| `MAX_EXPIRY_SECONDS` | 86400 on MAINNET (max), 30 d on CHIPNET | |
| `PUBLIC_API_URL` | | Must be public `https://` on MAINNET |
| `FULCRUM_URLS` | | Ports other than 50004 rejected; hosts on the wrong network skipped at connect |

`/admin/budget` response: `networkFeesSats` removed (always 0 once derived from shares); added `budgetWallet`, `priceLive`, `pendingSats`, `ledger`.

## Production re-test on Chipnet (2026-11-17, after deploying `994a5cd`)

- **GET backstop (P1-8):** unauthenticated GET `/internal/keeper/tick` → 401 (was 404). An authenticated GET ran a full tick.
- **P1-1 seen in production:** that first GET tick refunded two envelopes the old keeper had skipped every minute for hours: this morning's "Bob passes it on" envelopes, 2 shares of exactly **1,500 sats**. They came back as 1,193 sats each (fee 307 per share): [ef06df34…](https://chipnet.imaginary.cash/tx/ef06df342c293b8ca235e81507ec88e38fce9fd709c9e01d8347daee57f24e4d), [b3d62e30…](https://chipnet.imaginary.cash/tx/b3d62e304a420d97b6126e1a821ca160eeeb25181aa2373c9af06a7a9a8ad357).
- **Stale-connection fix (`b0b11d2`) seen in production:** between 13:30 and 13:38 UTC, cron ticks found the Fulcrum socket dead 5 times (`was stale … reconnecting`) and all returned 200. Without the fix each of those requests would have been a 503.
- **All four e2e suites pass against production:**
  - `api-e2e`: `ACTIVE` via [29ac208d…](https://chipnet.imaginary.cash/tx/29ac208d852f9e37dc02e6f25d395c5adc68fb5ac18c2d44f16eb4ec2df4b00d).
  - `claims-e2e`: 3 parallel stamped claims, `ENVELOPE_EMPTY`, `ALREADY_CLAIMED`, hold + quiz.
  - `lifecycle-e2e`: SSE `claimed` + `passedOn`, 2-generation tree, activation.
  - `campaign-e2e --single-ip`: every claim and fee reconciled with the chain; the public page leaks no addresses.
- **Script fix found by the re-test:** the e2e scripts measured draft txs with a flat 1,000-sat fee placeholder, which broke once the script wallet held ~20 coins. Fixed with `draftFee(inputs)` (`b48ca23`).
