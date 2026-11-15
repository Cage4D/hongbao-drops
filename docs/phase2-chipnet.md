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

## Observations

- **Genesis + BCMR + P2SH32 token outputs relay fine on Chipnet** when signed locally. The open question for `ENABLE_STAMPS` is only whether a WizardConnect *wallet* will sign it (`apps/wc-test`).
- **Fees as measured:** claim 485 sats; funding 351–610 sats. That matches Phase 0's size estimates, and `maxFee = 1,000` has 2× headroom.
- **Refunds open ~1 h after expiry.** A timestamp locktime is final only once median-time-past (median of the last 11 block times) passes it, and MTP trails wall-clock by about an hour. With `MIN_EXPIRY_SECONDS = 600`, the real refund delay is about 70 min. The UI copy should say "returns within about an hour after expiry", and the keeper must retry, not assume.
- **BCMR URI** in these txs points at `localhost:3000` (placeholder). Phase 6 serves the real registry at `PUBLIC_API_URL`.
