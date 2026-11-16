# Phase 5 — Lifecycle & live data: Chipnet e2e

`pnpm --filter @hongbao/scripts lifecycle-e2e` against the local API (`NETWORK=CHIPNET`), 2026-11-16.

## 1. Expired envelopes refund automatically (keeper, one batch tx each)

The first keeper tick found every expired envelope left from Phases 3–4 and refunded each in a single `refundBatch` tx (Layla loop), keylessly, to the sender:

| Envelope | Shares | Refund tx |
|---|---|---|
| Phase 3 e2e (stamped) | 3 | [2f81443a…](https://chipnet.imaginary.cash/tx/2f81443ad744fbf14c3d6ae2c6c0db28b15149060996ef1f09e91594325c8e0f). Locktime = expiry; 3 outputs to the sender's token address, each with its own stamp (`0100000001…03`) |
| Phase 3 e2e (BCH-only) | 3 | [b243c428…](https://chipnet.imaginary.cash/tx/b243c428ebd7551db0990842e727ab8013cf571eddd52a6d792927f9ce9fdb99) |
| Phase 4 envelope B (run 1) | 1 | [66e6592f…](https://chipnet.imaginary.cash/tx/66e6592f4759e5923a71619cf80bcab5faaf48f381dd42a27f32338032db15b9) |
| Phase 4 envelope B (run 2) | 1 | [5449371d…](https://chipnet.imaginary.cash/tx/5449371d31f05c2e7c072cc8b005a3a17db8b243000b9d0a4905e0e911da8970) |

Unfunded decoy envelopes from those runs were marked `EXPIRED`. `/health` shows the keeper heartbeat.

## 2. SSE shows claims live

Root envelope `m9ecmw` ([1314c7d8…](https://chipnet.imaginary.cash/tx/1314c7d8a44e60bd0a2aa753bc3e861f71238d521e5150b12973d29460df5e1f)). While a client streamed `GET /envelopes/:id/events`, a brand-new wallet claimed 9,555 sats ([fb2aa53f…](https://chipnet.imaginary.cash/tx/fb2aa53f07167c605a4f5ad6adaccb82e6948ad017e28e7278ce7c5f3a6bdf23)). The stream delivered:

```
claimed  {"usd":0.02,"sats":9555,"txid":"fb2aa53f…","stamp":null,"address":"bchtest:zzfa…gpn4",…}
passedOn {"sats":6000,"childId":"…","childSlug":"yshe2r","shareCount":2,…}
```

## 3. Pass it on → 2-generation tree

The claimer re-gifted 6,000 sats of their claimed coins as a LUCKY envelope `yshe2r` with `parentEnvelopeId` set ([481aaf18…](https://chipnet.imaginary.cash/tx/481aaf18d49c3eefea0d27e0fc530628b54606442c635638e665b2b2f059f3b8)). `GET /envelopes/<child>/tree` → 2 generations, reach 1, 1 pass-on, viral coefficient 1. The next keeper tick marked the claimer **activated** (they passed it on).

## Automated tests (`apps/api`, 64 passing; 12 for this phase)

- Keeper auth (bearer token) and the lease (two concurrent ticks → one runs).
- **Refunds:** waits while median-time-past ≤ expiry; then one tx returns all unclaimed stamped shares to the sender, each stamp on its own output. Envelope `REFUNDED`, `refunded` event, idempotent.
- **A sponsored drop funded without the fee** (rejected by verification, never `ACTIVE`, unclaimable) is still refunded after expiry. This makes the spec §4 promise ("their funds return to them") true.
- Never-funded envelopes → `EXPIRED`. Lapsed holds and reservations released.
- **Reconciliation:** a claim tx broadcast outside the API is recorded from chain data (share `CLAIMED`, claim `BROADCAST`, event emitted).
- Claims → `CONFIRMED` once mined.
- **Activation and farm flags:** coins moved → activated, with sweep destinations recorded. Two claimers sweeping to one address → `COMMON_SWEEP`. Idle 7 days → `NEVER_USED`. Unit test for `SAME_FINGERPRINT` and `IP_BURST`.
- **Pass it on:** a 3-generation tree, the `passedOn` event, and passing on counts as activation.
- **SSE:** live claim delivery, replay of recent events, resume with `Last-Event-ID`.

## Keeper safety (what to review)

- **No keys.** It can only build `refundBatch`, and the contract only lets that through after expiry (CLTV, and nodes also need MTP > expiry) and only to the refund script baked into the contract. Even a bug or a tampered DB can't refund early or to the wrong place: the network would reject the tx. The Phase 3 e2e showed this on-chain (`bad-txns-nonfinal`).
- It refunds **every refundable UTXO at an expired contract**, not just the shares in the DB. Dust coins (value − maxFee below dust) are left behind, since they can't be refunded. Candidates rotate and errors are isolated per envelope; see [review-1-fixes.md](review-1-fixes.md).
- A lease in `Setting` stops overlapping ticks across instances. Each step is isolated (one failing step doesn't stop the others) and errors appear in the tick summary.

## Review 1

An external review of phases 0–5 found 15 issues (none let anyone take funds or refund early). All are fixed in this phase. See [review-1-fixes.md](review-1-fixes.md).

### Chipnet re-run after the review fixes (2026-11-16)

- `claims-e2e`: all checks pass again: 3 parallel claims, `ENVELOPE_EMPTY`, `ALREADY_CLAIMED`, hold + quiz.
- `lifecycle-e2e`: the keeper refunded the two envelopes left from the first run, with 0 errors: [11eab2fe…](https://chipnet.imaginary.cash/tx/11eab2fe120c65ff4453f3815989a3f23167f37d5a5cac21e4b78f276ee88e8a) (1 share) and [e6cf3d8d…](https://chipnet.imaginary.cash/tx/e6cf3d8d4d5121185fdbd2fef5a26a94f08e71d7c505e44ad27324795a010b8f) (2 shares).
- SSE delivered `claimed` + `passedOn`. Tree: 2 generations.
- The claimer was marked **activated** by the stricter #2 check: the child's funding inputs were looked up on Chipnet and spent the claimer's own claimed coins.
