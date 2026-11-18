# Review 1 (phases 0–5): fixes

The review found no way to take funds or refund early. All 15 findings and the listed test gaps are fixed inside Phase 5. Each fix has a test that fails on the old code.

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | One dust coin (or an externally refunded envelope) blocked all refunds | `refundableUtxos()` leaves coins below dust + maxFee behind (counted as `dustSkipped`). Refund and reconcile candidates **rotate** by `refundCheckedAt` / `reconciledAt`. Errors are caught **per envelope** and land in `s.errors`. An envelope with no coins left but unspent DB shares is reconciled on the spot | `lifecycle › #1` (dust coin + broken envelope + externally refunded envelope + healthy one, in one tick) |
| 2 | An unfunded child envelope marked a farm claim "activated" and inflated the tree | Pass-on counts only a **funded** child whose funding tx spends a coin **from the claimer's address**. The tree only includes funded, non-`FAILED` envelopes | `lifecycle › review #2` (unfunded child + child funded from other coins) |
| 3 | Unfunded envelopes marked `EXPIRED` filled the daily cap for 24 h | Caps count **funded** envelopes (`fundedAt`), plus unfunded ones only in their first hour. Per-IP limit on `POST /envelopes` (20/h) | `budget › never-funded … stop counting` |
| 4 | Claim builder couldn't claim shares < 1,546 sats | Size measured with the output at the dust limit (amounts are always 8 bytes). Clear "too small to claim" error. `dustLimit()` matches the node rule | `claim › minimum share sizes` (exactly 1,500 and 2,000 sats; below dust) |
| 5 | Caps bypassable by funding an old pending envelope; check-then-insert race; no project total | Caps re-checked inside the `/funded` transaction. Both checks run under one advisory lock in the same transaction as the write. `BUDGET_TOTAL_USD` enforced: claimed (spent) + locked + new ≤ $5, with a warning at 80% | `budget › funding an old pending envelope`, `parallel creates`, `BUDGET_TOTAL_USD` |
| 6 | One address could collect two shares with two approvals | Every share ever approved for a recipient is kept (`approvedShareIds`). While one is unspent, the gate only re-reserves **that** share, never signs a second outpoint, and otherwise refuses | `claims › #6` |
| 7 | Rate limits and quiz guesses raceable in parallel | Count + record in one transaction under `pg_advisory_xact_lock(key)`. The quiz check runs inside that lock | `claims › #7` (12 parallel guesses → exactly 5 judged; parallel holds) |
| 8 | Duplicate broadcasts and overlapping ticks double-recorded | Broadcast: the envelope row is locked, and side effects run only if the `APPROVED → BROADCAST` conditional update wins. Keeper: lease value `expires#owner`, renewed before every step, released only by its owner. A refund txid is recorded once (checked against `refunded` events) | `claims › #8`, `lifecycle › #8` ×2 |
| 9 | Funding could also mint a minting NFT of the seal category | Verifier rejects any non-share output carrying `sealCategory` | `envelopes › minting NFT` |
| 10 | Reconcile hit `Claim.shareId` unique; the retry shortcut handed out spent shares | Reconcile detaches other claims from the share first. The retry shortcut needs a live, unspent reservation; otherwise the normal (pinned) path runs | `lifecycle › #10`, `claims › #10` |
| 11 | Coins at a fully claimed contract never refunded | Refund candidates are chosen by expiry, regardless of DB share state | `lifecycle › #11` |
| 12 | EQUAL not enforced | Verifier requires exactly `equalSplit(total, n)` for EQUAL | `envelopes › unequal split` |
| 13 | Envelopes stayed ACTIVE if the funding tx vanished | New status `FAILED`, set when no coins are left, the funding tx is unknown, and it's > 30 min after funding. Gate returns `NOT_FUNDED` | `lifecycle › #13` |
| 14 | Client IP read from the client-settable X-Forwarded-For | Only `CLIENT_IP_HEADER` (a header our host overwrites, e.g. Vercel's `x-vercel-forwarded-for`, **verify in Phase 8**) is trusted; otherwise the socket address | Covered by every rate-limit test (tests set the header explicitly) |
| 15 | Dropped claim txs stayed BROADCAST and could block confirmations | Confirmations rotate by `confirmCheckedAt`. A claim tx unknown > 30 min after the claim → claim `EXPIRED`, share back to `AVAILABLE` (reconcile reassigns it if it was actually spent) | `lifecycle › #15` |

## Test gaps closed

- Quiz and holds: now tested **in parallel** (#7).
- Reconcile: the stale-approval-wins case (#10) and the externally-refunded case (#1).
- Refunds: dust coin, several expired envelopes, one failing, extra coin at a claimed contract (#1, #11).
- "the old approval can no longer broadcast" renamed to "the API refuses to relay the old approval". It notes that the approval stays valid on-chain and is reconciled by the keeper.
- "refuses to relay a tx paying someone other": now spies on the provider and asserts the API **never relayed** it, instead of relying on the mock VM to reject it.
- Budget: funding an old pending envelope (#5) and `EXPIRED` unfunded envelopes (#3).
- Claim builder at exactly `minShareSats` (#4). Verifier with extra seal-category outputs (#9).

## Also found while fixing

- **Flaky `EXHAUSTED`:** parallel broadcasts could each miss the others' commits, so none saw "0 shares left". Fixed by the per-envelope row lock (#8).
- **`resetDb` in tests** didn't clear `RateEvent` / `Event`. Fixed.

Totals after the fixes: 140 tests (API 83, contract 53, shared 4).
