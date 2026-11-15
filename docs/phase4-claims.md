# Phase 4 — Claims & gate: Chipnet e2e

`pnpm --filter @hongbao/scripts claims-e2e` against the local API (`NETWORK=CHIPNET`), 2026-11-15. Every claimer is a brand-new key with zero BCH that signs nothing: the link secret plus the gate's approval unlock the share.

## Envelope A — 3 equal stamped shares (slug `jkd8mm`)

| Step | Result |
|---|---|
| Prep + funding | [26d57551…](https://chipnet.imaginary.cash/tx/26d57551e391a5ca4001bb84a0fc23a381383880112f63615d1b7521ad735613), [af6db214…](https://chipnet.imaginary.cash/tx/af6db214bb0e82eacf4c0e5a1d26101a2d6c97b3e1fc62e89ab7010c5762a66b) |
| **3 parallel claims** (3 IPs, fresh wallets) | 3 approvals, 3 different shares, all `isNewWallet=true` |
| Claim txs (2,515 sats + stamp each) | [1e80a399…](https://chipnet.imaginary.cash/tx/1e80a399d3eeb096e08b67e3708a1862a8d498a8231b74c99ce6f124b1d657b5) · [02ae0af6…](https://chipnet.imaginary.cash/tx/02ae0af69dbe3cc2d70ae979447ff94c4363f2ea690bde36b056a3226e0bc59a) · [a0826fbe…](https://chipnet.imaginary.cash/tx/a0826fbecb5ada5beacc5d95923c239dafc324df6b244d20c61089c0521cac53) |
| **4th claimer** | 410 `ENVELOPE_EMPTY` "Too slow! All the red envelopes have been grabbed." |
| **Double claim** (claimer 1, plain `q…` form of the same key) | 409 `ALREADY_CLAIMED` "You've already grabbed one from this envelope 🧧" |
| Public view | `EXHAUSTED`, 3 recent claims |

## Envelope B — 2 quiz shares, no stamps (slug `yzm45w`)

| Step | Result |
|---|---|
| Funding | [cf5f14c2…](https://chipnet.imaginary.cash/tx/cf5f14c28c6c74ba01dfbee544167d84827833ece2f668ba7fd933d78626fd6e) |
| **Hold my share** (no wallet yet) | 201, token valid 15 min |
| **Wrong answer** | 403 `WRONG_ANSWER`, `attemptsLeft: 4` |
| **Hold → claim with the right answer** (" bitcoin CASH ", normalised) | [3040b305…](https://chipnet.imaginary.cash/tx/3040b3059fcb89b6dc917e45caf06b294997aeaee14074b71348a634da3bae1c), 2,555 sats |
| Same wallet again (token-aware `z…` form) | 409 `ALREADY_CLAIMED` |
| Claim by the script wallet (has history) | `isNewWallet=false`. Approval latency **323 ms** (incl. Fulcrum `get_history`); retry 10 ms |

## Bugs found and fixed during this phase

- **Fresh-wallet detection silently returned `null` on Chipnet.** CashScript's Electrum provider re-opens its WSS connection per request by default (1–5 s TLS handshake), which blew the 1.5 s lookup timeout. Fix: one persistent connection per instance (`manualConnectionManagement`), opened at startup, and reset after any failure. `get_history` now takes about 400 ms. Timeouts are now logged instead of silent.
- **A returning claimer was told "Too slow!" after the envelope emptied.** The gate now checks "already claimed" before the empty/expired checks.
- A late rejection from a timed-out history lookup could have crashed the process (unhandled rejection). Now handled.

## Automated tests

`apps/api`: 52 passing. The 16 gate tests broadcast real claim txs that the mock network evaluates against `Hongbao.cash`, so the gate signature is proven to unlock the share. They cover:
- 3 parallel claims, and 8 simultaneous claimers on 3 shares (exactly 3 approvals);
- a recipient racing itself;
- per-address (both cashaddr forms) and per-fingerprint uniqueness;
- hold → claim, single-use hold tokens, holds blocking others, expired holds;
- quiz countdown, normalisation and rate limit;
- `NOT_FUNDED` and `ENVELOPE_EXPIRED`;
- the per-IP claim rate limit;
- an abandoned 120 s reservation being reused (and the stale approval refused);
- refusing to relay a tx to a different address;
- idempotent broadcast.
