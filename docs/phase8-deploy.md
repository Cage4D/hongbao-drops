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
| `claims-e2e` against production | 3 parallel seal-bearing claims (fresh wallets, `isNewWallet=true`), `ENVELOPE_EMPTY`, `ALREADY_CLAIMED`, hold + quiz ✅ |
| `GET /og/:slug.png` on Vercel | 1200×630, fonts render, ~1.7 s cold |
| `GET /seals/…png`, `GET /bcmr/…json` | 200. **Served registry sha256 `631e9f0e…` = the hash in the funding tx's OP_RETURN**, and the URI points at the production domain |
| Seal sent to the builder's Paytaca (Chipnet) | Delivered on-chain ([c79ec71c…](https://chipnet.imaginary.cash/tx/c79ec71cb330fc8b3a4efa6567aedf3110b03b60ebc948217339fd98d28449e9)), but **not visible in Paytaca's Chipnet view**, see below |

### Finding: Paytaca on Chipnet shows different addresses than it exposes over WizardConnect

> **Corrected later the same day:** the coin-type explanation below is wrong. The real cause is that **Paytaca's Chipnet indexer stopped at block 332402 (Nov 15)**. See "Root cause" below.

The xpub Paytaca shares over WizardConnect derives `bchtest:qqxcan93…tvrz`. Paytaca's own Chipnet screen shows a **different** receive address (confirmed by the builder). ~~Most likely the WizardConnect xpub is the coin-type-145 (mainnet) path, while the Chipnet wallet view uses coin type 1.~~

- Coins and seals sent to the WizardConnect addresses are safe (Paytaca signed spends from them in Phase 2), just **invisible in the app on Chipnet**.
- On **mainnet** both use coin type 145, so they should agree. **The wallet metadata check (seal name/image in Paytaca) moves to the first mainnet envelope (Nov 19).**
- **Note for the frontend session:** don't rely on Chipnet + Paytaca for any "see it in your wallet" demo.

### Chipnet re-test against production, 2026-11-17 (later the same day)

| Check | Result |
|---|---|
| `seal-to-wallet` to the address **Paytaca's own app shows** (`bchtest:qzzlwz…u9d2v`) | Funding [0d0a2b6a…](https://chipnet.imaginary.cash/tx/0d0a2b6aec810725edff29d025cef4ef210e727f4c793bd8d737a63465f78afe), claim [cf2ab71c…](https://chipnet.imaginary.cash/tx/cf2ab71cb23cc037e69a787cd2bc27f37e03969caaf734a4e7b699d47bd902f3): 4,515 sats + seal `0600000001`, confirmed in block 334907 |
| Plain 20,000-sat send to the same address (no token) | [ea8ce884…](https://chipnet.imaginary.cash/tx/ea8ce8847759b267b9816927bbebbbb8e44b000454b33476d10d75941d1590b9), confirmed in block 334913 |
| `api-e2e` against production | All checks pass. `ACTIVE` with 3 seal-bearing shares: [ab83af8e…](https://chipnet.imaginary.cash/tx/ab83af8e356f2ce76e28fc98c235e1ef5a4d02c5e28e3a1d3a54747fe9c645dc) |
| `claims-e2e` against production | All checks pass: 3 parallel seal-bearing claims ([731341…](https://chipnet.imaginary.cash/tx/731341188479db33d701a393d4f3c592804a7c5f631f57d606de88574e682042), [f7c3d4…](https://chipnet.imaginary.cash/tx/f7c3d4e2254200e90ef9646e306d2d28a013e018d6ae9d0d763a63596e56a470), [599d6e…](https://chipnet.imaginary.cash/tx/599d6e499cbaf039f58159d780a1586cb2479dd6a18a0f1f5b1a86ce0539b89a)), `ENVELOPE_EMPTY`, `ALREADY_CLAIMED`, hold + quiz ([6d4adf40…](https://chipnet.imaginary.cash/tx/6d4adf40faf24e61dfdb226a307cf9384efb95a5c726d0afac0be9b41a723fe2)) |

**Neither payment appeared in Paytaca, not even the plain BCH.** `scripts addr-check` shows both coins at the address on-chain. The cause is Paytaca's Chipnet backend: `https://chipnet.watchtower.cash/` (root and `/api/status/`) returns **HTTP 502**, while mainnet `https://watchtower.cash/api/status/` returns `{"status": "up"}`. Paytaca reads balances from that backend, so **Paytaca on Chipnet can't show anything right now**, whatever the address. This is outside our stack. The wallet display check stays on mainnet (Nov 19).

**Follow-up (06:10 UTC):** the Chipnet backend came back (`/api/status/` → `"up"`). A third payment, 10,000 sats ([4baa41a7…](https://chipnet.imaginary.cash/tx/4baa41a790f744fef59ff080a9b7d5c0848fe50ecfebd4906051b6abf9542ecc), block 334936), was sent while it was up. Paytaca still showed nothing. Asked directly, Paytaca's backend reports `GET /api/balance/bch/<address>/` → `balance: 0` and `GET /api/utxo/bch/<address>/` → `utxos: []`, while Fulcrum shows **34,515 sats in 3 confirmed transactions** at that address. Paytaca's Chipnet indexer isn't tracking the address even though it's up. Nothing our side can change.

### Root cause: Paytaca's Chipnet indexer is frozen at block 332402 (Nov 15)

The builder's Paytaca shows ~19k sats, from the Phase 2 WizardConnect test. The same backend query for the WizardConnect address `bchtest:qqxcan93…tvrz`, compared with Fulcrum (tip 334940):

| | Paytaca backend (`chipnet.watchtower.cash`) | On-chain (Fulcrum) |
|---|---|---|
| Balance | 18,836 sats | 8,044 sats |
| UTXOs | `dfeffbe9…:0` 11,984 · `8e4afb15…:5` 3,323 · `6857cc88…:0` 3,529 | `6857cc88…:0` 3,529 · `c79ec71c…:0` 4,515 + seal `0500000001` |

- Two of the backend's "unspent" coins were spent on Nov 15, by the WizardConnect txs Paytaca itself signed.
- Nothing after block 332402 is known to it, including the Phase 8 seal (block 334874) and all three payments to `qzzlwz…`.

Conclusions:
- **Paytaca on Chipnet shows a frozen Nov 15 snapshot.** Its `/api/status/` says `"up"`, but it isn't indexing new blocks.
- **The WizardConnect address is a Paytaca wallet address.** The backend holds its balance as part of the wallet. The "different address" in the app is most likely just the next receive address: Paytaca rotates to a new one after an address is used. So **WizardConnect-derived addresses are expected to work on mainnet**.
- The builder's real Chipnet holdings are 8,044 + 34,515 = 42,559 sats, including 2 seals. Paytaca will show them once its indexer catches up.
- The wallet display check moves to mainnet (Nov 19) because the Chipnet indexer is stale, not because of address derivation.

**Why it stopped: Paytaca's Chipnet node is on a chain split from the 1-minute-blocks upgrade.**
- Paytaca's backend publishes its node state. `GET https://chipnet.watchtower.cash/api/blockchain/info/` → `blocks: 332517, headers: 332517`, best block `00000000081874e3…`, `upgrade_status: "May 2026 Upgrade (chipnet)"`.
- Chipnet block 332517 is `000000000000707e…` on both `chipnet.imaginary.cash` and `chipnet.bch.ninja` (independent operators, tip ~334943). Same height, different block: Paytaca's node follows a separate chain, and it stopped there.
- The split falls between block 332402 (Nov 15 05:22 UTC, still shared) and 332517 (Nov 15 13:30 UTC). That matches the Chipnet activation of **CHIP-2025-03 (1-minute blocks)** at **2026-11-15 12:00 UTC**. Mainnet activates it on 2027-05-15. BCHN shipped the Chipnet preview release on Nov 14. A node still on the "May 2026" rules rejects the upgraded chain and stalls on its own minority branch.
- The upgraded chain's pace confirms it: ~2,400 blocks between Nov 15 13:30 and Nov 17 07:00 is about 1 block per minute.
- **Mainnet is unaffected** until May 2027. Paytaca's mainnet backend reports block 977720, consistent with 10-minute blocks since the 977417 tip recorded on Nov 15.
- **Cashonize check (wallet independent of Paytaca's Chipnet balance server):** a seal-bearing claim through the production API ([2714571c…](https://chipnet.imaginary.cash/tx/2714571c0fffff6b27c35ccea1a0c1b07adbbe1dfb5ae8c65359d977fc33a704), 4,515 sats + seal `0b00000001`) and 20,000 plain sats ([21e2b80d…](https://chipnet.imaginary.cash/tx/21e2b80da6af2cfa0ca02db5983ad1c9ebdd5e3caa160c2e6a295b8c0ba6623f)) to a fresh Cashonize Chipnet wallet. The builder saw the 0.0002 tBCH and **the NFT in Cashonize**, but **without name or image**. Our side checks out: the served registry's sha256 `b3d80238…` equals the OP_RETURN hash, and all 3 image URIs return 200 `image/png`. But `https://bcmr-chipnet.paytaca.com/api/tokens/<category>/` → `{"error": "category not found"}`. Paytaca's Chipnet metadata indexer has never seen a post-split category, so no wallet that resolves metadata through it can show our name or image on Chipnet. **Name and image remain the one thing to confirm on mainnet (Nov 19).** The Chipnet explorer (`chipnet.imaginary.cash`) **does** show the Hongbao seal image for this NFT (builder, 2026-11-17). An independent BCMR resolver that reads the OP_RETURN publication directly resolves our registry and images, which confirms the publication format is correct. Cashonize's missing image comes only from its metadata source (Paytaca's stalled Chipnet indexer).
- **Side effect for our Chipnet runs:** median-time-past now trails wall-clock by ~6 minutes instead of ~1 hour, so Chipnet refunds open sooner after expiry than the Phase 2 notes say. Mainnet keeps the ~1 h delay through the hackathon.

Check any Chipnet address yourself: `pnpm --filter @hongbao/scripts addr-check -- bchtest:…`

### Keeper, lifecycle and campaign suites against production, 2026-11-17

Run with the production `KEEPER_TOKEN` passed from the secrets file into the script's environment, never printed:

```bash
KEEPER_TOKEN="$(grep '^KEEPER_TOKEN=' ~/.local/share/hongbao-drops/prod-secrets.env | cut -d= -f2-)" \
FULCRUM_URLS=wss://chipnet.imaginary.cash:50004,wss://chipnet.bch.ninja:50004 \
pnpm --filter @hongbao/scripts lifecycle-e2e -- --api https://hongbao-drops-api.vercel.app --allow-no-refunds
```

**First production keeper run** (06:54 UTC): 0 errors, 4 expired test envelopes refunded, one `refundBatch` tx each: [79b2a484…](https://chipnet.imaginary.cash/tx/79b2a4843f9214e8ba826b55a522b699ae293811bf6cb31cc72de932538b4805) (3 shares), [147601ac…](https://chipnet.imaginary.cash/tx/147601aca78ec59fea4c1785df3ad2ba82aa99c5233060dc59ae637f3657444e) (3), [b21c5fb8…](https://chipnet.imaginary.cash/tx/b21c5fb88302fbb231e53f966750a0aaf2163106c391a526710179665d4d77e7) (1), [cae89fb9…](https://chipnet.imaginary.cash/tx/cae89fb9c1c5af5826dc5601a4e514df0a151d5b711d2cba4b19a2edbe7910a7) (1). `/health` shows the heartbeat.

**`lifecycle-e2e`: all checks pass.**
- The claim was delivered live over SSE: root [61b69ee0…](https://chipnet.imaginary.cash/tx/61b69ee0d7ee9648265a7be8e60861b3a78c18e791af668e63b6708317900b0a), claim [b39e365b…](https://chipnet.imaginary.cash/tx/b39e365b52b1ffe22e7a67dccde33de6b83714832b6c1750def8232e950d7a7e).
- The claimer passed it on from their claimed coins: [ae16c4fd…](https://chipnet.imaginary.cash/tx/ae16c4fd4ff7601bf4b6cd5c761bd08b34b569d932782ec7a0cfa1378b70b3e4), and `passedOn` was delivered over SSE.
- The tree shows 2 generations, viral coefficient 1, and the claimer is marked activated.

**`campaign-e2e` (first run): the client-IP check (review-1 #14) is verified on Vercel.**
- The script sends 3 CTA clicks with spoofed `X-Forwarded-For` values (2 distinct IPs). Production counted **1**, so Vercel overwrites the header and spoofing doesn't work. `CLIENT_IP_HEADER=x-forwarded-for` is safe on Vercel.
- All 4 claims came from this machine's one real IP within seconds, so production flagged all 4 as suspected farms (`activatedNotFarm 0`). That's correct.
- `campaign-e2e --single-ip` now expects exactly this.
- **Note for Phase 9's BLAZE Drop:** claimers sharing one network (venue Wi-Fi, carrier NAT) will be flagged too. Flags never block a claim, but they lower the headline "activated & not farm" number.

### Bug found in production: stale Fulcrum connection → `CHAIN_UNAVAILABLE`

The second `campaign-e2e` run got **503 `CHAIN_UNAVAILABLE`** on `POST /envelopes/:id/funded`. Vercel log: `getRawTransaction failed: Unable to send request to a disconnected server 'chipnet.imaginary.cash'`. The API keeps one WSS connection per instance. While the instance sat idle, the socket was dropped, and the next request failed. The API reset the connection, so only that one request failed. A judge's first claim after a quiet period would hit it.

**Fix (`b0b11d2`):** `ChainService.withProvider()` recognises dead-connection errors, reconnects (possibly to the next host) and retries the call **once**. It covers lookups, `/funded` verification, broadcasts (safe: a duplicate broadcast is "already known", which counts as success) and the fresh-wallet check. Parallel requests on a dead socket reconnect only once. 4 new unit tests; totals 167 (contract 53, shared 4, API 110).

### Script fixes from these runs

- `createAndFund` retries `/funded` while the API reports "not found on the network yet", and waits for freshly received coins. The scripts default to `chipnet.bch.ninja` and production uses `chipnet.imaginary.cash`, and a tx takes a few seconds to reach the other server. **The frontend should also retry `/funded` on `NOT_FUNDED` with that reason**, because wallets broadcast through their own servers.
- `lifecycle-e2e --allow-no-refunds` for re-runs after an earlier tick has already refunded everything expired.

## Mainnet switch, 2026-11-18

- **Demo wallet funded:** 1,463,629 sats in `c11b4ea01dbd59d8b53ceb029c9cb6d2cfe0b22b1d7b46f8cd9b517fea8202c4`.
- **Secrets:** new `GATE_MASTER_SEED`, `ADMIN_TOKEN`, `KEEPER_TOKEN`, `CRON_SECRET` in `~/.local/share/hongbao-drops/mainnet-secrets.env`.
- **Database:** Chipnet production data archived with `pg_dump` to `~/.local/share/hongbao-drops/chipnet-archive-20261118T170340Z.dump` (55 envelopes, 115 shares, 49 claims, 112 events), then the 9 app tables were truncated. Restore with `pg_restore --clean --no-owner -d <url> <dump>`. No Neon branch was made.
- **Vercel API env** switched to mainnet and redeployed. `/health`: `network: MAINNET`, `bch.imaginary.cash` at height 977913, DB up.
- **Keeper:** cron-job.org job `8882581` updated with the new `KEEPER_TOKEN`; `keeper.lastRunAt` advanced after the update.
- **Caps on the live URL (no spend):** 11 shares → 422 `MAX_SHARES`; 300,000 sats → 422 `MAX_ENVELOPE_USD`; 25 h expiry → 400. `/admin/budget`: budget wallet = demo wallet, `priceLive: true` ($205.63), $2.50 remaining, 0 spent.

### First mainnet envelope (Paytaca check)

`seal-to-wallet --shares 2 --sats 4000 --expiry-minutes 15`, slug `srjcj4`, seal category = the funding coin's txid.

| Step | Txid |
|---|---|
| Funding (2 seal-bearing shares, identity output, BCMR OP_RETURN) | `435d1f7c42e2f6bb8e3daa8b816ee7135b90b53b59a84c5e11547dc52852cfef` |
| Claim: seal `0100000001` + 1,515 sats → Paytaca | `7cebcb70d2a2c6bfb410adbca10e706478e9f15d8a9d6b23533a192e080fbfc6` |
| Refund of the other share (production keeper, once median-time-past passed expiry) | 2,000 sats → 1,648 back to the demo wallet |

- **Paytaca's backends already know the seal** within a minute: `watchtower.cash/api/utxo/ct/<addr>/` lists the token UTXO with name "Hongbao Seal #1-1" and the image URL, and `bcmr.paytaca.com/api/tokens/<category>/0100000001/` returns the collection and NFT metadata. The seal PNG serves 200 `image/png`.
- **The 1,515 sats ride on the seal's output** (one output carries both). Watchtower's BCH balance for the address is therefore 0: it doesn't count token-carrying UTXOs.
- **Result in the Paytaca app: seal shown, BCH not.** Paytaca (like most wallets) only counts token-free outputs as BCH balance. Gate failed on the BCH half.

### Fix: separate BCH output (contract change, `9874af7`, `97b2a1c`)

The contract allowed exactly one claim output, so the share's value had to ride on the seal. Now:
- `claim` allows an optional second, token-free output to the same recipient. Seal shares claim as **seal on a 666-sat output + the rest as plain BCH**. Too-small shares fall back to one output.
- `refundBatch` allows one extra pooled, token-free output to the sender, so refunded value also shows as BCH.
- The fee cap now covers all outputs together. The contract grew from 222 to 294 bytes with constructor args, adding ≈100 sats to each claim's fee. The minimum share stays at 2,000 sats (it still splits, leaving ≈744 sats BCH).
- Tests: contract 68, API 164, web 28. On Chipnet (local API): seal claim `666 + seal | 1,744`, pooled refund of 2 shares `666 + seal | 666 + seal | 3,794`.
- Deployed only after `srjcj4`'s refund had gone through, because the keeper builds refunds from the current artifact (an old-contract share would have been stranded).

### Paytaca recheck with the new contract: **passed**

`seal-to-wallet --shares 2 --sats 4000 --expiry-minutes 15`, slug `fzhqxh`.

| Step | Txid |
|---|---|
| Funding | `675ddbf80b9293f92c8f09fb6c7bb7ddb052f2c44c0ce205cb739cda0ab1c76b` |
| Claim: seal `0200000001` on 666 sats + **744 sats plain BCH** → Paytaca | `2c80387481aeecff19a6c826c82479a8e663a385eb81a4d776ba04e826cf34c5` |

**In the Paytaca app (builder, 2026-11-18): the BCH balance went up and "Hongbao Seal #2-1" shows with its name and image.** Watchtower picked the claim up only after it confirmed; the BCMR indexer had the collection within a minute. The Nov 19 must-pass gate is met.

### Judges' demo envelope (2026-11-18)

`demo-envelope --mainnet --yes-mainnet`: 10 × 5,000 sats with seals, 23.5 h, slug `gcbxxe` (id `cmwmlcdp5000208kxmg1ip6fc`, seq 5), registered with `/admin/demo/refill`. The share link (with its `#k=` secret) is in `scripts/.state/mainnet/demo-link.txt`, not in the repo.

| Step | Txid |
|---|---|
| Prep (vout-0 coin for the seal category) | `03efd4ec50c337b6e5a9708028fac1e68f6b7c06e4273ffdd52cd9bfa800b871` |
| Funding | `f212e603250e591d471dfacaf82e283838abea729ecadb704f1750fc1a2ca35a` |

Two script bugs showed up on the way, fixed in `2638fe8`: the size-measuring draft's flat fee was too small for a 10-seal funding tx (refused at 0.99 sat/B before broadcast), and a stalled API call hung the run **after** the funding tx was broadcast. The envelope was recovered by hand (`POST /envelopes/<id>/funded` with the txid, then `/admin/demo/refill`). The failed attempts left two unfunded envelopes (seq 3 and 4, no coins), which expire on their own.

## Still to do

- ~~**Keeper scheduler (builder)**~~ **Done 2026-11-17:** cron-job.org job `8882581`, `POST /internal/keeper/tick` every minute (UTC) with `Authorization: Bearer KEEPER_TOKEN`, created by `scripts/setup-keeper-cron.sh`. The script reads the cron-job.org API key (`~/.local/share/hongbao-drops/cronjob-api-key`) and `KEEPER_TOKEN` from files and never prints them. Re-running it updates the same job, e.g. after rotating the token on the mainnet switch. Check: `scripts/setup-keeper-cron.sh --status` and `/health` → `keeper.lastRunAt`. The daily Vercel Cron backstop stays configured.
- **Mainnet switch on Nov 19** (day 6, spec §10.1). **Step-by-step: [phase8-mainnet-runbook.md](phase8-mainnet-runbook.md)** (demo wallet and treasury created, `--mainnet` script mode, Fulcrum re-probed, $3 budget):
  1. A dedicated demo wallet funded with ≤ $5.
  2. `NETWORK=MAINNET`, mainnet `FULCRUM_URLS` and `TREASURY_ADDRESS`, **new** `GATE_MASTER_SEED` and a fresh database (Chipnet envelope sequence numbers must not mix with mainnet gate keys). Since review 2 the API also **refuses to start** without `BUDGET_WALLET_ADDRESS` (the demo wallet) and a public `https://` `PUBLIC_API_URL`, and skips Fulcrum hosts on the wrong network. See [review-2-fixes.md](review-2-fixes.md).
  3. Tiny funding, claim and batch-refund txids; `/admin/budget` < $1 spent.
  4. Paytaca seal check on mainnet.
