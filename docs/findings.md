# Phase 0 findings — answers to spec §15

Date: 2026-11-15. BCH/USD at time of writing: **$206.49** (CoinGecko), so 1,000 sats ≈ $0.002.

Everything marked **[tested]** is backed by code in this repo you can rerun:

```bash
pnpm --filter @hongbao/contract test          # test/spikes.test.ts — 10 semantics checks
node packages/contract/spikes/sizes.mjs       # dust floors + tx sizes
node packages/contract/spikes/measure.mjs ./draft-hongbao.cash   # P2S vs P2SH32 size
pnpm --filter @hongbao/scripts probe:fulcrum  # live Fulcrum probe
```

## Decisions at a glance

| Question | Decision |
|---|---|
| CashScript version | **0.14.0** (cashc + SDK) |
| Deploy as P2S? | **No.** Spec draft compiles to 222 bytes; P2S limit is 201. Deploy as **P2SH32** |
| Loops / `refundBatch()`? | **Yes.** `do…while` compiles to `OP_BEGIN … OP_UNTIL` and passes VM validation for 1, 5, 10 and 20 shares. This is the "built on Layla" feature |
| `minShareSats` | **2,000** with seals, **1,500** without (≈ $0.004 / $0.003) |
| `maxFee` (per input) | **1,000 sats** (claim tx ≈ 483 B, refund ≈ 341 B per share, so about 2 sat/B of headroom) |
| Seal go/no-go | **GO** (Phase 2): Paytaca signed the genesis funding tx over WizardConnect on Chipnet, see docs/phase2-chipnet.md |
| Fulcrum | Chipnet: `chipnet.imaginary.cash`, `chipnet.bch.ninja`. Mainnet: `bch.imaginary.cash`, `fulcrum.greyh.at`. All on WSS port 50004 with `get_history` working |
| Hosting | **Decided: Vercel for frontend, API and DB** (Neon Postgres via the Vercel Marketplace). Keeper runs from an external per-minute cron (approved 2026-11-15), see §7 |
| `sealCategory` on `POST /envelopes` | **Approved** (builder, 2026-11-15) |
| Funding output 0 = identity output to treasury | **Approved** (builder, 2026-11-15) |
| Mainnet totals caps scope (§10.1) | **Demo wallet only** (`BUDGET_WALLET_ADDRESS`); per-envelope caps for everyone. Builder, 2026-11-17, review 2 Q1 |
| Cap re-check at `/funded` | Only when funded > 1 h after creation. Builder, 2026-11-17, review 2 Q2 |
| Max expiry on mainnet | **24 h**. Builder, 2026-11-17, review 2 Q3 |

---

## 1. CashScript 0.14 syntax and semantics

Source: [release notes](https://cashscript.org/docs/releases/release-notes), [instantiation docs](https://cashscript.org/docs/sdk/instantiation), plus the experiments below.

| Item | Finding |
|---|---|
| Version | `cashscript@0.14.0`, `cashc@0.14.0` (npm `latest`, 2026-11). Default VM target `BCH_2026_05` (Layla) |
| `bytes4(int)` | **Renamed** in 0.13 to `toPaddedBytes(x, 4)`. `bytes4(...)` from the spec draft no longer compiles |
| Outpoint encoding **[tested]** | `tx.inputs[i].outpointTransactionHash` is the txid in **internal byte order (reversed from the displayed txid)**. `toPaddedBytes(outpointIndex, 4)` is **4-byte little-endian** (`vout=1` → `01000000`). The gate must therefore sign `recipientLockingBytecode ‖ reverse(txidHex) ‖ u32le(vout)`. A test proves that the display-order txid fails |
| `checkDataSig` **[tested]** | Verifies a 64-byte **Schnorr** (or DER ECDSA) signature over **`sha256(message)`**, with no sighash byte. Gate code: `secp256k1.signMessageHashSchnorr(gatePriv, sha256(msg))`. Signing the raw message fails |
| Token fields on token-less UTXOs **[tested]** | Category and commitment read as empty and amount as 0, so `==` between a token-less input and output passes. Dropping an NFT fails on the `tokenCategory` check |
| Capability byte **[tested]** | `tokenCategory` includes the capability byte for mutable/minting NFTs. A consensus-legal `mutable → none` downgrade fails on the `tokenCategory` check, and a changed commitment fails on `nftCommitment`. Seals are minted with capability `none` (32-byte category), so any upgrade would change the length and fail |
| `tx.time` **[tested]** | Compiles to `OP_CHECKLOCKTIMEVERIFY`, so the refund tx needs `locktime >= expiry`, a non-final input sequence, and on a real network `locktime <= median-time-past`. Note: `MockNetworkProvider` does **not** check time-based finality, so that last part gets tested on Chipnet in Phase 2 |
| Loops **[tested]** | `for`, `while` and `do…while` all exist. **Gotcha:** a function's final statement must be a `require()`, so `refundBatch` needs a trailing `require(i == tx.inputs.length);` after the loop |
| Loop cost | `refundBatch` re-checks all pairs from every input (O(n²)). A 20-share batch still passes VM validation. Keeper cap stays at 20 (spec §6.4); `MAX_SHARES` is 10 anyway |
| P2S **[tested]** | Supported via `new Contract(artifact, args, { provider, contractType: 'p2s' })`. P2S locking bytecode limit is **201 bytes** including constructor args. The draft contract is **222 bytes** (≈120 bytes script + ≈102 bytes args). A trimmed variant (P2PKH hash + constant fee) came out *larger* (227) because building P2PKH in-script costs more than it saves. P2S contracts also have no cashaddr (`address`/`tokenAddress` are undefined) |
| Other 0.14 changes that matter | `TransactionBuilder` UTXOs must carry `lockingBytecode`; `MockNetworkProvider` validates against the VM by default (good for the test matrix); `HashType` → `SighashType` |

**P2S / Layla plan:** deploy as **P2SH32**, and claim Layla through the loop-based `refundBatch()`, which spec §5 allows ("and/or"). Pitch line: "batch refunds use the 2026 loop opcodes, so one transaction returns every unclaimed share." If P2S matters for the pitch, the only real lever is removing a 33-byte key, which would break the two-key security model. Not recommended.

## 2. WizardConnect

Sources: [protocol](https://wizardconnect-456f57.gitlab.io/protocol), npm `@wizardconnect/core@0.2.10`, `@wizardconnect/dapp@0.2.7`, `@bch-wc2/interfaces@0.0.16` (type definitions inspected).

- **What the dapp gets on connect:** only **xpubs** for named paths (`receive`, `change`, `defi`), with no addresses. The dapp derives addresses itself; `DappConnectionManager.pubkeyState` does on-demand derivation. The session runs over Nostr relays (`@wizardconnect/core` ships `utilnostr`).
- **Token-aware address:** not provided by the wallet, but trivial to build: the same pubkey hash encoded as cashaddr type `p2pkhWithTokens` (`bitcoincash:z…`, libauth `encodeCashAddress`). So the claimer's token-aware address works in practice ✅.
- **Wallet fingerprint (spec §8.2):** `sha256(receive xpub)`. Stable per wallet and never reveals the xpub to the server.
- **Sign request:** `WcSignTransactionRequest = { transaction: libauth Transaction | hex, sourceOutputs, broadcast?, userPrompt? }` plus `inputPaths: [inputIndex, pathName, addressIndex][]`. The wallet signs only the listed inputs, with **`SIGHASH_ALL | FORKID | UTXOS`**.
  - Structurally, outputs are arbitrary libauth outputs, so token genesis outputs, OP_RETURN and P2SH32 outputs are all expressible.
  - **Unverified:** whether Paytaca/Cashonize *accept and display* a genesis tx with N NFT outputs to a contract. That is exactly the Phase 2 go/no-go test (spec §5.1).
- **Supported wallets:** the protocol page names none. Paytaca publishes `@paytaca/wizardconnect-vue`, which strongly suggests Paytaca supports it. Cashonize support gets confirmed in Phase 2.
- **Genesis vout-0 rule:** the browser must choose a sender UTXO with `vout == 0` as input 0, or make the prep tx. Not testable without a wallet; Phase 2.

## 3. Dust floors → `minShareSats` [tested]

From CashScript's `calculateDust` (the SDK's implementation of the node dust rule; it grows with output size, which is why token outputs need more):

| Output | Dust |
|---|---|
| P2PKH, plain | 546 |
| P2PKH + immutable NFT (5-byte commitment) | 666 |
| P2SH32 (contract share), plain | 576 |
| P2SH32 + NFT | 696 |

A claim output = share − fee (≈ 500 sats), and must stay ≥ 666 when it carries a seal. A refund output has the same constraint. Hence **`minShareSats = 2,000` with seals, `1,500` without**: tiny in USD and comfortably above every floor. The API enforces it in Phase 3.

## 4. Transaction sizes → `maxFee` [tested]

| Tx | Size |
|---|---|
| Claim, BCH-only share | 443 B |
| Claim, share with seal | 483 B |
| `refundBatch`, 1 share | 350 B |
| `refundBatch`, 5 / 10 / 20 shares | 1,710 / 3,410 / 6,810 B (≈ 341 B per share) |

Every input is under 500 B, so **`maxFee = 1,000` sats per input** covers up to 2 sat/B. Claim txs will actually pay about 1 sat/B, roughly 500 sats ≈ $0.001.

## 5. BCMR

Source: [CHIP-BCMR](https://github.com/bitjson/chip-bcmr).

- **Publication output:** `OP_RETURN <'BCMR'> <sha256(registry bytes)> <uri>…`, prefix `6a 04 42434d52`. The hash is in **VM byte order** (raw `sha256` output, not reversed). URIs are UTF-8 and may omit `https://`. Several URIs are allowed, but at most one BCMR output per tx.
- **Identity:** the authbase is the tx whose output 0 the authchain follows. For a token, that is the **category id = txid of the outpoint spent by input 0**. That txid is known *before* the funding tx is built, so the registry JSON (keyed by the category) and its hash can be computed first. There is no self-reference problem.
- **Authchain gotcha:** the authchain follows **output 0** of each tx. The funding tx spends the authbase's output 0, so the funding tx becomes the authhead and carries the publication. If funding **output 0 were a share**, the first claim would move the authhead to a claim tx with no publication, and wallets might lose the metadata. **Approved:** funding output 0 is a small (546-sat) **identity output to the treasury address** that is never spent, followed by the shares, the BCMR OP_RETURN and change. Cost ≈ $0.001 per envelope, recoverable later.
- **Commitment encoding gotcha:** BCMR sequential NFTs read the commitment as a **VM number**. With `commitment = envelopeIndex(4 bytes) ‖ shareIndex(1 byte)`, the share byte is the most significant byte. `shareIndex = 0` would be a non-minimal number, and anything ≥ `0x80` flips the sign. **Use 1-based share indexes (1…10).** Then `nfts.parse.types` is keyed by the commitment hex.
- **Registry must be byte-stable:** the API must store the exact registry JSON it hashed and serve those bytes from `/bcmr/:category.json`, never re-serialize them.
- **API flow impact (deviation, approved):** the API can't compute the BCMR hash until it knows the category. So `POST /envelopes` needs an extra optional field, **`sealCategory`** (the txid of the vout-0 UTXO the browser will spend as input 0), whenever `withSeals` is on.
- **Wallet pickup:** most CashTokens wallets resolve metadata through Paytaca's indexer (`bcmr.paytaca.com`), which watches chain for BCMR publications. Cashonize's resolver isn't documented. Verified for real in Phase 6 with a Chipnet seal.

## 6. Fulcrum servers [tested 2026-11-15]

`pnpm --filter @hongbao/scripts probe:fulcrum` — WSS, protocol 1.5 client:

| Network | Server | Result |
|---|---|---|
| Chipnet | `chipnet.imaginary.cash:50004` | ✅ Fulcrum 2.1.4, `get_history` ✅, tip 332396 |
| Chipnet | `chipnet.bch.ninja:50004` | ✅ Fulcrum 2.1.3, `get_history` ✅ (CashScript's default) |
| Chipnet | `cbch.loping.net:62104` | ❌ WS 1006 |
| Mainnet | `bch.imaginary.cash:50004` | ✅ Fulcrum 2.1.4, `get_history` ✅, tip 977417 |
| Mainnet | `fulcrum.greyh.at:50004` | ✅ Fulcrum 2.1.4, `get_history` ✅ |
| Mainnet | `electroncash.de`, `bch.loping.net`, `bch.cyberbits.eu` | ❌ |

Two working servers per network is enough for the fallback list (`FULCRUM_URLS`). Re-run the probe before Phase 8.

## 7. Hosting — decided: Vercel (frontend, API, DB)

Builder's decision (2026-11-15): host everything on Vercel. Limits that shape the design, from Vercel docs ([cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [function limits](https://vercel.com/docs/functions/limitations)):

| Vercel Hobby limit | Impact | Plan |
|---|---|---|
| Cron jobs **once per day**, ±59 min | Keeper can't run every minute from Vercel Cron | Keeper becomes a stateless `POST /internal/keeper/tick` (protected by a `KEEPER_TOKEN` bearer). An **external free cron** (cron-job.org) calls it every minute. A daily Vercel Cron runs as a backstop |
| Function max duration **300 s** (streamed responses included) | SSE streams get cut at 5 min | `EventSource` reconnects automatically. Events are read from Postgres (an event table + `Last-Event-ID`), never kept in memory, so any instance can serve them |
| No long-lived process | No permanent Fulcrum subscription | Each request or tick opens or reuses a cached WSS client (Fluid compute reuses warm instances). Confirmations are polled by the keeper tick instead of pushed |
| No cold-start guarantee | First judge click may be slower | Fluid compute cold starts are short; the per-minute keeper cron also keeps an instance warm |
| Postgres | Vercel Postgres is now Neon via the Marketplace | Prisma with the **pooled** connection string; migrations use the direct URL |

Consequences for later phases: Phase 3 builds the NestJS app so it can run as a Vercel function (verify NestJS-on-Vercel support then). Phase 5's keeper and SSE follow the table above. New env vars: `KEEPER_TOKEN`, `DIRECT_DATABASE_URL`. Spec §10's uptime-monitor requirement is covered by the per-minute keeper cron.

## 8. Pre-kick-off rule

Can't be checked from here (Telegram). It's moot now: kick-off was 14 Nov 14:00 UTC, and this repo's first commit is 15 Nov.

---

## Changes the Phase 1 contract will make to the §5.3 draft

1. `bytes4(...)` → `toPaddedBytes(..., 4)`.
2. Trailing `require(i == tx.inputs.length);` after the `do…while` (compiler rule).
3. The gate signs `lockingBytecode ‖ txid in internal byte order ‖ u32le(vout)`. A helper in `@hongbao/contract` builds this message so API and tests can't drift apart.
4. Deployed as P2SH32 (default `contractType`).

## Tooling choices

- **TypeScript 6.0.3**, not 7.x: 7 is the native-compiler line, and NestJS relies on `emitDecoratorMetadata`. Keep the boring option.
- **Vitest 4.1** (5.x is days old).
- **Prisma 7.10.x** in Phase 3: npm `latest` is currently an 8.0 release candidate.
- **NestJS 12**, **Zod 4**, **pnpm 12** workspaces.
- The spike contracts in `packages/contract/spikes/` are evidence only. The real `Hongbao.cash` is written from scratch in Phase 1.
