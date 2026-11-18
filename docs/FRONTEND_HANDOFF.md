# Hongbao Drops: frontend handoff

Everything the frontend needs to know about the backend, contract and wallet integration: what to build (functionally), the exact API, how to build the transactions, and the problems already found. **The visual design is yours.** This doc only covers what has to work.

Written 2026-11-18 by the backend session. If something here disagrees with the code, the code wins (`packages/shared/src/schemas.ts` holds the API types). Tell the backend session about it.

---

## 0. The product in 60 seconds

A sender drops a **red envelope** of BCH into a group chat as one link. The first N people who open it each get a share. Every claimer also gets a **collectible stamp** (an NFT). Claimers need **no BCH and sign nothing**. The money sits in an on-chain **lockbox** (a contract). Nobody can take it back early, not even the sender, and **leftovers return automatically** to the sender after expiry.

Modes: **EQUAL** (same share each), **LUCKY** (random amounts), **QUIZ** (answer a question to claim).

Extras:
- **Hold my share:** for people with no wallet yet; reserves a share for 15 min.
- **Pass it on:** re-gift part of your claim as a new envelope.
- **Sponsored Drops:** branded envelopes; 3% fee; a funnel dashboard.

Use the same plain words as the README: **lockbox**, **collectible stamp**, **leftovers return automatically**. Avoid jargon in the UI (no "UTXO", "P2SH", "BCMR", "gate").

### Any BCH wallet; Paytaca suggested and required to work

**Anyone can use any BCH wallet**: connect over WizardConnect, or paste an address. **Paytaca is the default suggestion** wherever someone needs to *get* a wallet ("No wallet yet? Try Paytaca", the install link in "Hold my share", "Get Paytaca" in the footer). No other wallet is named.

Paytaca is also a sponsor of BCH BLAZE 2026, so the product **must work end-to-end with Paytaca, on a phone, on mainnet**. It's the wallet to build and test against.

| With Paytaca | Status |
|---|---|
| Connect over WizardConnect and sign the stamped funding tx | ✅ proven on Chipnet (Phase 2, first try) |
| Claim to a Paytaca address (no signing needed) | ✅ works on any network: the BCH + stamp land on-chain |
| Paytaca **showing** the received BCH and the stamp (name + image) | ⏳ **only provable on mainnet**: Paytaca's Chipnet servers are stuck (§11). This is the **first check on Nov 19** |
| The full judge flow on a phone (open link → connect Paytaca → claim → see it in Paytaca) | ⏳ mainnet, Phase 9 |

## 1. Environment

| | |
|---|---|
| API (production) | `https://hongbao-drops-api.vercel.app` |
| Network today | **CHIPNET** (BCH test network) |
| Network from Nov 19 | **MAINNET**. The production database is **wiped** at the switch, so Chipnet envelopes disappear |
| Which network? | Read `GET /health` → `network` (`"CHIPNET"` / `"MAINNET"`). Don't hard-code it |
| Frontend | `https://hongbao-drops.vercel.app` (Vercel project `hongbao-drops`, root `apps/web`) |
| CORS | Browsers are answered only from the frontend: `https://hongbao-drops.vercel.app`, its `hongbao-drops-*-cage4ds-projects.vercel.app` aliases and previews, and `localhost`. Add more with `CORS_ORIGINS` (comma-separated). `/bcmr`, `/stamps`, `/og` and `/health` stay open to any site. See `apps/api/src/common/cors.ts` |
| Submission deadline | **22 Nov 14:00 UTC.** The top risk is the judge's claim flow on a phone, on mainnet |

Per network:

| | Chipnet | Mainnet |
|---|---|---|
| Cashaddr prefix | `bchtest:` | `bitcoincash:` |
| WIF network (libauth) | `'testnet'` | `'mainnet'` |
| Fulcrum (WSS :50004) | `chipnet.imaginary.cash`, `chipnet.bch.ninja` | `bch.imaginary.cash`, `fulcrum.greyh.at` |
| CashScript provider | `new ElectrumNetworkProvider('chipnet', { hostname })` | `new ElectrumNetworkProvider('mainnet', { hostname })` |
| Explorer tx link | `https://chipnet.imaginary.cash/tx/<txid>` | `https://blockchair.com/bitcoin-cash/transaction/<txid>` |
| Test coins | faucets `tbch.googol.cash`, `chipnet.bch.ninja` (or ask the backend session to send some) | real BCH |

### Recommended setup

Build the frontend **inside this monorepo** as `apps/web` (pnpm workspace). Then you can import the two packages the backend already maintains:

- `@hongbao/shared`: every request/response type, the Zod request schemas (reuse them for form validation), and `ERROR_CATALOG`.
- `@hongbao/contract`: `buildClaimTx`, `fundingOutputs`, `MIN_SHARE_SATS_WITH_STAMP` (2000) / `MIN_SHARE_SATS_NO_STAMP` (1500), `dustLimit`, `hongbaoContract`. These are the same builders the API's tests use, so the transactions match what the contract and API expect.

Pinned versions that are known to work together (from `apps/wc-test`):

```
cashscript 0.14.0 · @bitauth/libauth ^3.1.0-next.8
@wizardconnect/core 0.2.10 · @wizardconnect/dapp 0.2.7 · @wizardconnect/react 0.2.6
react ^19 · vite ^8
```

`apps/wc-test/src/main.tsx` is a **working** (throwaway) WizardConnect page: it connects Paytaca, derives addresses, scans coins, and has a wallet sign a funding tx with stamps. Copy freely from it.

If the frontend lives in a separate repo, the packages aren't published to npm: vendor `packages/shared` and `packages/contract`, or ask for a build.

---

## 2. What the frontend must have (functional)

| Screen | Must do |
|---|---|
| **Landing** | What it is in one line; a **Try it** button (demo link, §11); global stats from `GET /stats/global`; "Send your own" |
| **Create envelope** | Connect wallet (WizardConnect) → amount, number of shares, mode, message, theme, expiry, stamps on/off, quiz (Q + up to 3 answers) → sign in wallet → show the **share link** to copy/share |
| **Envelope / claim page** (`/e/<id>#k=…` and `/<slug>#k=…`) | Shows message, theme, sponsor branding, amount left, shares left, countdown, recent claims (with "luckiest"), and the stamp. Three ways to claim: **connect wallet**, **paste address**, **Hold my share**. Quiz input in QUIZ mode. Live updates (SSE) |
| **Success** | "Money arrived" **immediately** after broadcast (unconfirmed is fine). Amount in BCH + USD, the collectible stamp image, explorer link, **Pass it on** and **Send your own** |
| **Pass it on** | Create a child envelope from the claimed coins (default suggestion: 50% into 3 shares), with `parentEnvelopeId` |
| **Tree view** (optional but in the pitch) | "This drop reached X people across Y generations" from `GET /envelopes/:id/tree` |
| **Sponsor** | Create sponsor → token **shown once** (make them save it) → create campaign → create sponsored envelopes → dashboard (`/campaigns/:id/stats`), CSV download, shareable **public proof page** (`/campaigns/:id/public`) |
| **Link previews** | Server-rendered `og:` / `twitter:` meta tags on envelope URLs (§9). Telegram and X don't run JS |
| **Errors** | Show `error.message` from the API **as-is**. It's written for end users (§8) |

---

## 3. The share link and the link secret

```
https://<frontend>/e/<envelopeId>#k=<linkSecretWIF>
https://<frontend>/<slug>#k=<linkSecretWIF>      (short form; slug = 6 chars, resolve with GET /s/:slug)
```

- The browser that **creates** the envelope generates the link keypair. Only the **public** key goes to the API (`linkPk`). The private key goes **only** into the URL fragment.
- The fragment (`#k=…`) is never sent to any server; keep it that way. Don't put it in query strings, analytics, logs, error reports, `localStorage` on other origins, or `og:url`.
- **Whoever has the link can claim.** That's the product. But the server keeps everyone to one share each.
- The server **never** stores link secrets, so a lost link can't be recovered. Before leaving the create screen, make sure the sender has copied or shared it.

```ts
import { generatePrivateKey, secp256k1, encodePrivateKeyWif, decodePrivateKeyWif, binToHex } from '@bitauth/libauth';

const linkPriv = generatePrivateKey();
const linkPk = binToHex(secp256k1.derivePublicKeyCompressed(linkPriv) as Uint8Array); // → POST /envelopes
const wif = encodePrivateKeyWif(linkPriv, network === 'MAINNET' ? 'mainnet' : 'testnet');
const shareUrl = `${location.origin}/e/${created.id}#k=${wif}`;

// Claim page:
const k = new URLSearchParams(location.hash.slice(1)).get('k');
const decoded = k ? decodePrivateKeyWif(k) : 'missing';
if (typeof decoded === 'string') { /* show "this link is incomplete — ask the sender for the full link" */ }
const linkPrivateKey = decoded.privateKey;
```

---

## 4. Flow A: create and fund an envelope

The sender's wallet signs **one** transaction, or **two** if a "prep" transaction is needed first (see step 2).

**1. Connect the wallet (WizardConnect)** and derive addresses from the session xpubs (§10). Scan the wallet's coins via Fulcrum. Use **BCH-only** coins (skip ones carrying tokens), unless you deliberately handle tokens (see the pass-it-on note in §6).

**2. Stamps need a coin at output index 0 (CashTokens rule).** The new stamp collection's ID (the "category") is the txid of the coin that input 0 spends, and that coin must be at **vout 0**.
- If the wallet has a vout-0 coin big enough, use it as input 0.
- Otherwise build a **prep tx**: a self-send of the wallet's coins to one output (so it lands at vout 0). Have the wallet sign and broadcast it, then use its output 0. Chaining the next tx on this unconfirmed one works.
- Without stamps (`withStamps: false`) there's no vout-0 rule.

**3. `POST /envelopes`** (see §7 for every field):

```json
{
  "senderAddress": "bitcoincash:q…",
  "linkPk": "02…",
  "shareCount": 5,
  "mode": "LUCKY",
  "totalSats": 50000,
  "expiry": 1795000000,
  "message": "Happy Lunar New Year!",
  "theme": "lunar",
  "withStamps": true,
  "stampCategory": "<txid of the vout-0 coin that will be input 0>"
}
```

- `senderAddress` is where leftovers return. Use one of the connected wallet's addresses. The plain `q…` and token-aware `z…` forms encode the **same** locking script, so either works, unclaimed stamps included.
- The response is `CreateEnvelopeResponse`. The key field is **`fundingTemplate`**: the exact outputs the funding tx must have, **in order**.

**4. Build the funding tx:**
- **Outputs:** `fundingTemplate` exactly as given, then **change** last. Shares that carry a stamp have `token: { category, nftCommitment }`; create it as an immutable NFT, `capability: 'none'`, amount 0.
- **Input 0:** the `stampCategory:0` coin. Further inputs are any other wallet coins.
- **Output order (with stamps):** `0` identity (546 sats to the treasury) · `1…N` shares · then the sponsor fee if sponsored · then the BCMR OP_RETURN · then change. Without stamps: `0…N-1` shares · sponsor fee · change. **Never add another output that pays the contract or carries the new stamp category.**
- **LUCKY** templates already contain a random split. Use it as-is. EQUAL must match exactly.
- **Fee:** 1 sat/byte. Measure the draft size, and **don't use a flat 1,000-sat placeholder fee** while measuring. With 20+ coins, CashScript rejects a draft paying < 1 sat/B. That bug bit our scripts and is still in `apps/wc-test` (`signAndSend`, `1_000n`). Use something like `200 × inputs + 1000` for the draft, then the real `size × 1`. Placeholder unlockers are empty: add ~107 bytes per P2PKH input for the signature and public key (as `wc-test` does).

```ts
import { hexToBin } from '@bitauth/libauth';
const outputs = created.fundingTemplate.map((o) => ({
  to: hexToBin(o.lockingBytecode),
  amount: BigInt(o.sats),
  ...(o.token && { token: { category: o.token.category, amount: 0n, nft: { capability: 'none' as const, commitment: o.token.nftCommitment } } }),
}));
// then: inputs [input0, ...rest] with placeholderP2PKHUnlocker, addOutputs(outputs), addOutput(change)
// → generateWcTransactionObject → relay-safe serialisation (§10) → manager.signTransaction(...)
```

**5. Broadcast** the signed tx yourself: `provider.sendRawTransaction(signedHex)`, with `broadcast: false` in the WC request.

**6. `POST /envelopes/:id/funded {"txid"}`.** The API verifies the transaction on-chain and returns `{ status: "ACTIVE", shares: [...] }`.
- **Retry while** the error is `409 NOT_FUNDED` with `reasons` containing `"transaction not found on the network yet"`. The API's Fulcrum server may not have seen your tx yet. Retry every 2 s for up to ~30 s. Our scripts needed this.
- `422 FUNDING_MISMATCH` with `reasons: [...]` means the tx doesn't match the template. That's a bug on our side or yours; show the generic message and log the reasons.
- Calling `/funded` again with the same txid is safe (idempotent).

**7. Show the share link** (§3). The envelope is live.

Amounts the wallet needs: `totalSats` + 546 (identity, with stamps) + sponsor fee (if any) + tx fee (~1 sat/B; a few hundred sats), + the prep tx fee if needed.

---

## 5. Flow B: claim

**1. Load the envelope:** `GET /envelopes/:id` (or `GET /s/:slug`) → `PublicEnvelopeView`.
- Check `status`: `ACTIVE` (claimable), `PENDING_FUNDING` (sender hasn't finished), `EXHAUSTED` (all grabbed), `EXPIRED`/`REFUNDED` (over), `FAILED` (funding vanished).
- Check `shares.left` and `secondsLeft`.

**2. Get a recipient address**, one of three ways:
- **Connect wallet** (WizardConnect): derive the **token-aware** (`z…`) address from the session's `receive` xpub (§10), so the stamp lands somewhere the wallet shows tokens. Also send `walletFingerprint = sha256hex(utf8(receiveXpub))`. Never send the xpub itself.
- **Paste address:** accept `q…` or `z…` for the current network. Both are the same locking script, so the BCH and stamp arrive either way. The `z…` form only tells sending software "this wallet understands tokens".
- **Hold my share** (no wallet yet): `POST /envelopes/:id/holds {"fingerprint"?}` → `{ holdToken, heldUntil }`.
  - Store `holdToken` in `localStorage`, keyed by envelope.
  - Show "No wallet yet? Try Paytaca" with the install link (https://www.paytaca.com) and the countdown to `heldUntil` (15 min).
  - When they come back, claim with `holdToken` plus their new address.
  - Limits: 2 holds per IP per envelope per 15 min, and at most half the shares held at once. Beyond that you get `429 RATE_LIMITED`.

**3. `POST /envelopes/:id/claims`:**

```json
{ "recipientAddress": "bitcoincash:z…", "walletFingerprint": "…64 hex…", "holdToken": "…", "answer": "Bitcoin Cash" }
```

Only `recipientAddress` is required. `answer` is required for QUIZ; matching is case-insensitive and ignores extra spaces. The response `201` is a `ClaimApproval`: `{ claimId, share, gateSig, recipientLockingBytecode, constructorArgs, reservedUntil, isNewWallet }`. The share is reserved for **120 s**, so build and broadcast straight away.

**4. Build and broadcast the claim tx.** No wallet signature is needed: the link key signs.

```ts
import { buildClaimTx } from '@hongbao/contract';
const { hex } = buildClaimTx({
  provider,                                  // ElectrumNetworkProvider for the network (no network call happens here)
  constructorArgs: ap.constructorArgs,
  share: ap.share,
  recipientLockingBytecode: ap.recipientLockingBytecode,   // use exactly this: the API refuses to relay to any other address
  linkPrivateKey,                            // from #k=
  gateSig: ap.gateSig,
});
const r = await fetch(`${API}/claims/${ap.claimId}/broadcast`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawTx: hex }) });
// 200 → BroadcastResponse { txid, amountSats, amountUsd, stamp: { category, commitment, imageUrl, alt } | null }
```

**5. 200 means the money arrived.** Unconfirmed is final enough for the UI ("0-conf"). Show `amountSats` (the share minus its own ~440–490-sat network fee), `amountUsd`, `stamp.imageUrl` with `stamp.alt`, and the explorer link. Broadcasting again is idempotent.

Errors to expect while claiming (all have human `message`s):

| Code | When | UX |
|---|---|---|
| `ENVELOPE_EMPTY` 410 | No shares left | Show it; offer "Send your own" |
| `ENVELOPE_EXPIRED` 410 | Past expiry | Show it |
| `ALREADY_CLAIMED` 409 | This address/wallet/hold already claimed. May carry `reason`: *"An earlier approval for this address is still open. Try again in a few minutes."* | Show `reason` if present |
| `WRONG_ANSWER` 403 | Quiz answer wrong; has `attemptsLeft` | Show the attempts left |
| `RATE_LIMITED` 429 | Too many tries (5 wrong answers / 10 min per IP; claims 10 / 10 min) | Show it; let them retry later |
| `HOLD_EXPIRED` 410 | The held share was released | Offer to claim normally |
| `NOT_FUNDED` 409 | Envelope not active yet | Show it |
| `CHAIN_UNAVAILABLE` 503 | Network hiccup; the reservation survives | **Retry the same request** after a few seconds |
| `INVALID_REQUEST` 400 | Bad address etc.; `issues: [{path, message}]` | Field-level message |

---

## 6. Flow C: pass it on

After a successful claim, offer to re-gift part of it. It's Flow A with the **claimer's** wallet, plus `parentEnvelopeId: <envelope they claimed from>`.

- **It only counts if the funding spends the claimed coins** (input from the claimer's address). That's what marks the claimer as "activated" and what puts the child envelope on the tree.
- **The claimed coin is at vout 0** (a claim tx has one output), so it can be input 0 of the genesis directly, with no prep tx.
- **⚠️ The claimed coin carries the stamp NFT.** If you spend it, add an output that sends **the old stamp back** to the claimer's token address. CashScript refuses to burn tokens by default, which is good. Value: at least the token dust (~700 sats is safe; use `dustLimit(25, token)` from `@hongbao/contract`).
- Suggested defaults: 50% of what they got, 3 shares. The claimed share is small (a few thousand sats), so check against `minShareSats × shareCount` + fees.
- The parent page's live stream gets a `passedOn` event.

---

## 7. API reference

Base: `https://hongbao-drops-api.vercel.app`. JSON bodies (`content-type: application/json`, ≤ 64 kB). All amounts are integer **sats** (JSON numbers), and USD where shown (`null` when the price is unknown). Types are in `@hongbao/shared`.

### Envelopes and claims

| Method & path | Body | Returns |
|---|---|---|
| `POST /envelopes` | `CreateEnvelopeRequest` | `201 CreateEnvelopeResponse` |
| `POST /envelopes/:id/funded` | `{ txid }` | `200 FundedResponse` |
| `GET /envelopes/:id` | | `PublicEnvelopeView` |
| `GET /s/:slug` | | `PublicEnvelopeView` |
| `POST /envelopes/:id/holds` | `{ fingerprint? }` | `201 HoldResponse` |
| `POST /envelopes/:id/claims` | `ClaimRequest` | `201 ClaimApproval` |
| `POST /claims/:claimId/broadcast` | `{ rawTx }` | `200 BroadcastResponse` |
| `GET /envelopes/:id/events` | | SSE stream (§8) |
| `GET /envelopes/:id/tree` | | `TreeResponse` |
| `POST /envelopes/:id/cta-click` | | `204`, when a sponsor's CTA is clicked (counted once per IP per hour) |
| `POST /wallets/activity` | `{ lockingBytecodes: string[] }` (the connected wallet's own P2PKH locking bytecodes, 1–40) | `WalletActivityResponse`: sealed envelopes it sent (pass-ons have `parentEnvelopeId`), shares it claimed (each with `passedOn` if it was re-gifted), totals. 30 per IP per 10 min. Powers the site's "My drops" page |

`CreateEnvelopeRequest` fields:

| Field | Rules |
|---|---|
| `senderAddress` | Cashaddr of the current network; refunds go here |
| `linkPk` | Compressed pubkey hex (`02…`/`03…`) |
| `shareCount` | 1–10 on mainnet (1–127 on Chipnet) |
| `mode` | `EQUAL` \| `LUCKY` \| `QUIZ` |
| `totalSats` | ≥ `minShareSats × shareCount` (2,000/share with stamps, 1,500 without). Mainnet: ≤ $0.50 and ≤ 200,000 sats per envelope |
| `expiry` | Unix seconds. ≥ now + 600. ≤ now + **24 h on mainnet** (30 days on Chipnet) |
| `message` | ≤ 280 chars, optional |
| `theme` | `classic-red` (default) \| `gold` \| `christmas` \| `lunar` |
| `withStamps` | Default `true` |
| `stampCategory` | **Required when stamps are on**: the txid of the vout-0 coin that will be input 0 |
| `quiz` | `{ question ≤200, answers: 1–3 strings ≤100 }`; required for QUIZ, forbidden otherwise |
| `sponsorToken`, `campaignId` | Sponsored drop: adds the fee output to the template. `campaignId` needs `sponsorToken` |
| `parentEnvelopeId` | Pass it on |

### Sponsors and stats

| Method & path | Auth | Body → Returns |
|---|---|---|
| `POST /sponsors` | none (5 per hour per IP) | `{ name, logoUrl?, brandColor? "#RRGGBB", ctaLabel?, ctaUrl? }` (https URLs; label and URL go together) → `201 { sponsorId, sponsorToken }`. **Token shown once** |
| `POST /campaigns` | `Authorization: Bearer <sponsorToken>` | `{ name }` → `201 { campaignId }` |
| `GET /campaigns/:id/stats` | Bearer sponsor token (own campaigns only, others 404) | `CampaignStats` |
| `GET /campaigns/:id/export.csv` | Bearer sponsor token | CSV, one row per claim |
| `GET /campaigns/:id/public` | none | `PublicCampaignStats` (no addresses): the shareable "proof of reach" |
| `GET /stats/global` | none | `GlobalStats` (landing page) |

Sponsored envelopes cost the sender **3% (minimum 546 sats)** extra, as a fee output that's already in `fundingTemplate`. Dashboard terms (show them in plain words): **fresh wallets** (no history before the claim) → **activated** (used the BCH or passed it on within 7 days) → **activated & not suspected farm**, which is the headline denominator for **cost per real new wallet**.

### Media (for `<img>` and meta tags)

| Path | What |
|---|---|
| `GET /og/:idOrSlug.png` | 1200×630 link-preview card. Use `view.og.imageUrl` + `view.og.alt` |
| `GET /stamps/:category/:commitment.png` (`.svg`) | One collectible stamp (512×512). Use `BroadcastResponse.stamp.imageUrl` |
| `GET /stamps/:category/collection.png` | The envelope's collection image (`view.stamp.imageUrl`) |
| `GET /bcmr/:category.json` | Wallet metadata (wallets fetch this; you don't need it) |

### Ops (not for the UI)

`GET /health` (network, chain, keeper heartbeat, price) is fine to read for the network. `/admin/*` and `/internal/*` are operator-only.

---

## 8. Errors, live updates, retries

**Every error** looks like `{ "error": { "code": "…", "message": "…", ...extra } }`. Show `message` as-is; the copy lives in `ERROR_CATALOG` (`@hongbao/shared`). The extras:

| Extra | On |
|---|---|
| `issues: [{ path, message }]` | `INVALID_REQUEST` |
| `reasons: string[]` | `FUNDING_MISMATCH`, `NOT_FUNDED`, some `INVALID_REQUEST` (e.g. *"this share was already spent"*) |
| `attemptsLeft` | `WRONG_ANSWER` |
| `cap`, `limit` | `BUDGET_CAP` (e.g. `MAX_SHARES`, `MAX_ENVELOPE_USD`, `BUDGET_TOTAL_USD`) |
| `reason` | `ALREADY_CLAIMED`, `RATE_LIMITED` |

**Retry rules:**
- `CHAIN_UNAVAILABLE` 503: retry the same call after 2–5 s.
- `/funded` + `NOT_FUNDED` "not found on the network yet": retry for ~30 s.
- Everything else: don't auto-retry.

**Live updates (SSE):** `new EventSource(`${API}/envelopes/${id}/events`)`. Event names and payloads (each also has `at`, ISO):

| Event | Payload |
|---|---|
| `claimed` | `{ shareIndex, address (truncated), sats, usd, isNewWallet, luckiest, txid, stamp, sharesLeft, reconciled? }` |
| `held` | `{ shareIndex, heldUntil }` |
| `exhausted` | `{ claimed }` |
| `refunded` | `{ txid, shares, sats }` (leftovers returned) |
| `passedOn` | `{ childId, childSlug, shareCount, sats }` |

- On connect, recent events are replayed. Each stream ends after ~280 s, and `EventSource` reconnects by itself, resuming from `Last-Event-ID`.
- **Open one stream per envelope page and close it when leaving.** Opening is rate-limited (30 per IP per 10 min).
- Updates arrive within ~2 s.

---

## 9. Link previews (important for the pitch)

When a link is pasted into Telegram, WhatsApp or X, their crawlers fetch the page **without running JS**. The envelope routes (`/e/:id`, `/:slug`) must therefore return server-rendered meta tags, e.g. via an edge or SSR function that calls `GET /envelopes/:id` or `GET /s/:slug`:

```html
<meta property="og:title" content="🧧 A red envelope for you">
<meta property="og:description" content="<message> · <shares.left> of <shares.total> left · $<remaining.usd>">
<meta property="og:image" content="<view.og.imageUrl>">
<meta property="og:image:alt" content="<view.og.alt>">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
```

The fragment `#k=` never reaches the crawler, so previews can't leak the secret. The card image is cached for 60 s server-side and shows live "N of M left".

---

## 10. WizardConnect: what we learned (Phase 2, Paytaca)

- **The wallet gives only xpubs** for the paths `receive` (child 0), `change` (1) and `defi` (7). **Derive addresses yourself:** `hash160(manager.getPubkey(child, index))` → cashaddr `p2pkh` and **`p2pkhWithTokens`** (z…). See `deriveAddresses()` in `apps/wc-test/src/main.tsx`.
- **Wallet fingerprint** = `sha256(utf8(receive xpub))` as hex (`wc-test` logs it).
- **Sign request:**
  - Call `manager.signTransaction({ transaction, inputPaths })` with `inputPaths: [inputIndex, pathName, addressIndex][]` and `broadcast: false`, then broadcast it yourself.
  - The wallet signs with `SIGHASH_ALL | FORKID | UTXOS`.
- **Serialise for the relay:** the transaction as hex, and source outputs with hex bytes and `"<bigint: Xn>"` strings. Passing CashScript's `generateWcTransactionObject()` result directly throws *"Do not know how to serialize a BigInt"*. Copy `toRelayRequest()` from `wc-test`.
- **Pairing can fail silently** (console: *"Key exchange timed out"*) while a saved session still makes the page look connected. Show the **real** connection state and offer **Reconnect**.
- Paytaca signed the stamped genesis funding tx (N NFTs to a contract + OP_RETURN) on the first try. Paytaca is the wallet to build and test against (see "Any BCH wallet; Paytaca suggested and required to work").
- **The WizardConnect addresses are part of the Paytaca wallet.** The address in Paytaca's app may differ only because Paytaca moves on to a new receive address after one has been used.

---

## 11. Demo link, limits and other things to know

- **"Try it" demo link:** the server never stores link secrets, so the demo link (with `#k=`) is configured in the frontend, e.g. as an env var `VITE_DEMO_URL`. The backend session will create and fund the mainnet demo envelope once your URL exists, then give you the link. Refills happen one at a time; the operator registers each new one.
- **Refund timing copy:** say *"Leftovers return automatically about an hour after the envelope expires."* On mainnet a refund only becomes valid ~1 h after expiry (block-time rules). On Chipnet it's minutes.
- **A rare wait:** if someone else's claim of the same share is still unconfirmed, a claimer may get `ALREADY_CLAIMED` with *"try again in a few minutes"* (up to ~10 min on mainnet). That's deliberate; it stops one address getting two shares.
- **Farm flags:** claims from one network (venue Wi-Fi) are flagged `SAME_IP` in sponsor dashboards. Flags never block a claim.
- **Mainnet caps** apply to everyone per envelope: ≤ 10 shares, ≤ $0.50, ≤ 24 h. Aggregate caps only protect the project's own demo wallet. Show `BUDGET_CAP` messages as-is.
- **Testing on Chipnet with Paytaca: connecting and signing work, balances don't show.** Paytaca's Chipnet servers have been stuck on an abandoned chain since the Nov 15 network upgrade (they report a balance of 0 for addresses that hold coins). So on Chipnet:
  - WizardConnect connect + signing with Paytaca **work**: your page supplies the coins from Fulcrum, and Paytaca only signs.
  - Coins and stamps sent to a Paytaca address **arrive** but **don't appear in the app**. Check them on the explorer (`https://chipnet.imaginary.cash/address/<addr>`; it even shows our stamp images) or with `pnpm --filter @hongbao/scripts addr-check -- <addr>`.
  - Building the "see it in your wallet" screens against Paytaca on Chipnet isn't possible. Verify those on mainnet from Nov 19. Mainnet Paytaca is in sync (checked Nov 17).
- **Known API copy nit:** the alt text says *"a classic red red envelope"* (the theme name is doubled). The backend will fix it; don't work around it.

## 12. What the backend needs back from you

1. Your **production and preview origins** (for CORS, before submission).
2. Your **frontend URL**, so the README's "Try it" link and the demo envelope can be set up.
3. **Any API mismatch or missing field**: report it rather than working around it. Fixes are cheap on the backend side.
4. **Button wording** for the claim flow, so the README's "Try it in 30 seconds" steps match the UI.
