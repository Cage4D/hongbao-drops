# Phase 3 — API foundation: Chipnet e2e

`pnpm --filter @hongbao/scripts api-e2e` against the local API (`NETWORK=CHIPNET`), 2026-11-15:

| Check | Result |
|---|---|
| `GET /health` | ok, chain `chipnet.bch.ninja` |
| `POST /envelopes` (3 stamped shares, 9,000 sats) | 201, slug `cnba6m` |
| `POST /envelopes/:id/funded` with an unknown txid | 409 `NOT_FUNDED`, status stays `PENDING_FUNDING` |
| Prep tx | [f7e708ab…a6a9](https://chipnet.imaginary.cash/tx/f7e708abb5b1a408c636f543ad275ce56ae3fd260d9502f4908563811444a6a9) |
| Funding tx built from the API's `fundingTemplate` | [4c64949f…5c84](https://chipnet.imaginary.cash/tx/4c64949fe016b92f3f6e9dfe4dc2c2c68448d65aea087f4bcdd7df2c24185c84) |
| Same tx submitted for a *different* envelope | 422 `FUNDING_MISMATCH` ("share 1: output 0 doesn't pay the envelope contract" + 6 more reasons) |
| Same tx for the right envelope | 200 `ACTIVE`, 3 shares at vouts 1–3 with stamps `0100000001…03` |
| `GET /s/cnba6m` | `ACTIVE`, 9,000 sats ($0.02) left |
| BCH-only variant (`--no-stamps`) | Funding [93d15edc…ae1f](https://chipnet.imaginary.cash/tx/93d15edcf0122b5c6cc547bb375f8408d71990f15f1de8aedadc3a77699dae1f), same checks pass |

Automated tests: `apps/api` 36 passing (real Postgres + MockNetworkProvider). Coverage:
- create, validation and quiz hashing;
- funded flows, idempotency, and tampering (sum, wrong script, stray contract output, missing BCMR, wrong commitment, missing sponsor fee, tx reuse);
- public view without secrets;
- all five mainnet budget caps;
- the funding verifier's genesis-input check;
- config validation.
