# Phase 7 — Sponsors & analytics

## Endpoints

| Method & path | Auth | What |
|---|---|---|
| `POST /sponsors` | none (5/h per IP) | Creates a sponsor and returns `sponsorToken` **once** (`hbs_…`). Only its sha256 is stored |
| `POST /campaigns` | sponsor token | `{name}` → `{campaignId}` |
| `GET /campaigns/:id/stats` | sponsor token (own campaigns only; others → 404) | Funnel, money, cost per wallet, CTA, pass-on reach, per-envelope rows, every txid |
| `GET /campaigns/:id/export.csv` | sponsor token | One row per claim: address, share outpoint, sats, claim txid, fresh / activated / farm flags. Formula-injection safe |
| `GET /campaigns/:id/public` | none | Shareable **proof of reach**: the same numbers and txids, no addresses, fingerprints or IPs |
| `GET /stats/global` | none | Landing-page totals (cached 30 s) |
| `POST /envelopes/:id/cta-click` | none | 204. Counted at most once per IP per envelope per hour |

Sponsored envelopes: `POST /envelopes` with `sponsorToken` (+ `campaignId`). The funding tx must then pay a fee of **max(3%, 546 sats)** to the treasury, or it never becomes `ACTIVE` (Phase 3 verifier).

## Metric definitions (spec §4)

Counts cover claims of the campaign's **funded** envelopes.

| Metric | Definition |
|---|---|
| `freshWallets` | Recipient had **no on-chain history** before the claim (Fulcrum `get_history`, recorded by the gate) |
| `activatedWallets` | Fresh **and** (claimed coins moved within 7 days **or** the claimer passed it on: a funded child envelope paid from the claimed coins; keeper) |
| `activatedNotFarm` | Activated **and** not flagged by the farm heuristics. This is the **headline denominator** |
| `pendingActivation` | Fresh claims still inside their 7-day window |
| `spentSats` | Claimed share sats (value that left the sponsor, incl. the claim tx fee each share paid) **+** sponsor fees. Locked or refunded coins are not spend |
| `costPerActivatedNewWalletUsd` | `spentUsd / activatedNotFarm` |
| `ctr` | CTA clicks per claim |
| `passOnEnvelopes` / `totalReach` | Funded descendants of the campaign's envelopes (any depth) / claims including those descendants |

## Chipnet e2e: `pnpm --filter @hongbao/scripts campaign-e2e` (2026-11-16)

A seeded campaign through the real API on Chipnet, then **reconciled with the chain**. Every claim txid in the CSV was fetched from Fulcrum and decoded:
- it spends the listed share outpoint;
- it pays exactly `received_sats` to the listed address;
- the claimed share sats sum to `givenAwaySats`;
- the funding txs' fee outputs (at the index the API required) pay the treasury and sum to `feesSats`.

| | |
|---|---|
| Envelope 1 (3 equal shares, 18,000 sats) | [caa18370…](https://chipnet.imaginary.cash/tx/caa18370eac782dc57e96c73a9fd4016921a8d1bdff0857a710b05e167db256a) |
| Envelope 2 (2 lucky shares, 8,000 sats) | [11a7af26…](https://chipnet.imaginary.cash/tx/11a7af266ebb1f0301247a6d4de6cd3260779281b4d488e250edb9aee0689248) |
| Alice (fresh) spends her BCH → activated | [08002ad5…](https://chipnet.imaginary.cash/tx/08002ad59f5ea59765f36a3745c0ca03a093d23b69ce29d4ba44fffb0ac3b700) |
| Bob (fresh) passes it on from his claimed coins → activated + reach | [30099075…](https://chipnet.imaginary.cash/tx/300990751d70aaf0149c14f6fba99bd8c40b929d084d68839ae6913dc036120d) |

Result: 4 claims → 3 fresh (one claim came from an existing wallet) → 2 activated → 2 not farm. Fees 1,092 sats (2 × the 546 minimum). Spent = given away + fees. Pass-on 1. CTA clicks 2 (3 clicks from 2 IPs). The public page shows the same numbers without addresses.

## Bug found by the Chipnet run

- **3% of a small sponsored envelope is below dust**, e.g. 3% of 18,000 = 540 < 546. That made the funding tx impossible to build. Fixed: the fee is `max(3%, 546 sats)`. Test: `envelopes › small sponsored drops pay at least the 546-sat dust minimum`.

## Tests

`apps/api` 101 passing (9 new). The main one is a seeded campaign with **hand-computed expected numbers** for every field: funnel, `givenAway`, fees, spent USD, cost per activated / fresh wallet, locked sats, CTR, pass-on, total reach, per-envelope rows, CSV rows, the public page (no addresses) and global stats. Also covered: auth (no token, wrong token, another sponsor's campaign → 404), field validation, unfunded sponsored envelopes adding nothing, and CTA dedupe.
