# Phase 2 — Chipnet transactions

Explorer: `https://chipnet.imaginary.cash/tx/<txid>`. Re-check any tx yourself:

```bash
pnpm --filter @hongbao/scripts inspect -- <txid>
```

Test wallet funded with 1,017,000 Chipnet sats (faucet) on 2026-11-15. All txs pay 1 sat/byte.

## Envelope `stamps1` — 3 equal shares, stamps on (genesis in the funding tx)

| Step | Tx | Notes |
|---|---|---|
| Funding + genesis | [e29f87de…adc53](https://chipnet.imaginary.cash/tx/e29f87de8794f42e97453477d637dd1afae2b75e6eacac496c08b95b194adc53) | Input 0 = faucet UTXO at **vout 0**, so no prep tx was needed. Outputs: `0` 546-sat identity → treasury · `1–3` 10,000-sat shares → P2SH32 contract, each with an immutable stamp (category `cae19aad…ed50`, commitments `0100000001`, `…02`, `…03`) · `4` BCMR OP_RETURN · `5` change. Fee 610 sats |
| Claim share #1 | [41641d91…ed4f9](https://chipnet.imaginary.cash/tx/41641d911704c5557e53b763b5b13f9115e02272db94a621cef2966975ded4f9) | 1-in/1-out. 9,515 sats + stamp `0100000001` → brand-new token address. Fee 485 sats, paid by the share |
| Claim share #2 | [cd10e9b0…aa84f](https://chipnet.imaginary.cash/tx/cd10e9b07545ce8aca69550b9f543ab2193333d312779bade82f6508134aa84f) | Same shape, stamp `0100000002` |
| Batch refund (share #3) | _pending: refunds open once median-time-past > expiry_ | |

## Envelope `plain1` — 3 lucky shares, no stamps, 3% sponsor fee

| Step | Tx | Notes |
|---|---|---|
| Funding | [def1d542…7bde1](https://chipnet.imaginary.cash/tx/def1d542fc7fc1d1b4bf986c4b274674d12992158ded8efc9bc36c0b4b27bde1) | Shares 6,269 / 8,237 / 5,494 (lucky split, sums to 20,000) at outputs 0–2, **600-sat treasury fee** (300 bps) at output 3, change. Fee 351 sats |
| Batch refund (3 shares) | _pending_ | |

## Envelope `stamps2` — 2 shares, stamps on, needed the **prep tx**

| Step | Tx | Notes |
|---|---|---|
| Prep (vout-0 outpoint) | [72eafc97…f134](https://chipnet.imaginary.cash/tx/72eafc97e558a180018386a263d6e239d956c8518d78406b7210e71c1014f134) | The wallet's coins were at a non-zero vout, so `fund` consolidated them into a 1-output self-send. Its txid became the stamp category |
| Funding + genesis | [cab0ef47…a218](https://chipnet.imaginary.cash/tx/cab0ef47a7d2d364a85085e556bf839656a32082e7fb373220c22df35500a218) | Chained on the unconfirmed prep tx (0-conf chain accepted). Fee 526 sats |
| **Early refund attempt** | rejected | `refund --force` before median-time-past passed expiry → node replied `bad-txns-nonfinal, non-final transaction (code 64)`. **On-chain proof nobody can refund early** (the mock network can't check this) |
| Batch refund (2 stamped shares) | _pending_ | |

## WizardConnect wallet test (`apps/wc-test`) — stamp go/no-go: **GO**

**Paytaca** (Chipnet mode), paired by QR over WizardConnect, signed every request on the first try (one input each, `SIGHASH_ALL|FORKID|UTXOS`). The page broadcast the results.

| Tx | What the wallet signed |
|---|---|
| [b74f1d9a…fbca](https://chipnet.imaginary.cash/tx/b74f1d9ad8a3fd87511b7c7d65cc74c09dd3fa550bb8db8a479adbea29f2fbca) | BCH-only funding: 3 × 2,500-sat shares to a P2SH32 contract + change |
| [dfeffbe9…f774](https://chipnet.imaginary.cash/tx/dfeffbe9ded82dc9b2a47d97f638eee1a85cc058709aa1eda3df5590fae8f774) | Prep tx (1-in/1-out self-send → vout-0 outpoint) |
| [8e4afb15…b997](https://chipnet.imaginary.cash/tx/8e4afb151f3464ce7d2d865d2344bfc666aeddbdda66df6e3555d036ec04b997) | **Genesis funding**: identity output, 3 shares each minting an immutable stamp (category `dfeffbe9…`, commitments `fafa0a0001…03`), BCMR OP_RETURN, change |
| [6857cc88…0b19](https://chipnet.imaginary.cash/tx/6857cc886bd800906bb8c13cfd33aec0afb86abf81fc10439088c98fe9a50b19) | Second prep (2 inputs) |

**Decision: `ENABLE_STAMPS=true`.** Stamps stay in the core scope.

What the frontend must do (learned the hard way):
- **Serialize sign requests in the relay format**: transaction as hex, source outputs with hex bytes and `<bigint: Xn>` amounts. `@wizardconnect/core` has `sourceOutputToRelay()` but doesn't export it from the package index. Passing CashScript's `generateWcTransactionObject()` result directly throws `Do not know how to serialize a BigInt`.
- **Pairing can silently fail** (`Key exchange timed out` in the console) while a saved session still makes the page look connected. Show real wallet status, and offer "reconnect".
- Wallet sent paths `receive`, `change`, `defi` (child 0, 1, 7). Deriving `bchtest:` addresses from the `receive` xpub matched where the wallet holds its Chipnet coins.
- The test page sent the identity output to the wallet's own address, and the next prep tx consolidated (spent) it. In the product the identity output goes to the **treasury**, which never spends it, for exactly this reason.

## Observations

- **Genesis + BCMR + P2SH32 token outputs relay fine on Chipnet** both when signed locally and when signed by a real WizardConnect wallet (above).
- **Fees as measured:** claim 485 sats; funding 351–610 sats. That matches Phase 0's size estimates, and `maxFee = 1,000` has 2× headroom.
- **Refunds open ~1 h after expiry.** A timestamp locktime is final only once median-time-past (median of the last 11 block times) passes it, and MTP trails wall-clock by about an hour. With `MIN_EXPIRY_SECONDS = 600`, the real refund delay is about 70 min. The UI copy should say "returns within about an hour after expiry", and the keeper must retry, not assume.
- **BCMR URI** in these txs points at `localhost:3000` (placeholder). Phase 6 serves the real registry at `PUBLIC_API_URL`.
