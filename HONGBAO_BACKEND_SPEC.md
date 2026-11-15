# Hongbao Drops — Backend, Smart Contract & Infrastructure Spec (v2)

> Handoff brief for Claude. Scope of this session: **smart contract + backend + infrastructure only.** The frontend is built in a separate session — but this spec defines the API, the data the UI needs, and the client-side transaction steps.
>
> **Budget: $5 of real BCH total for the whole project — hard limit.** Develop on Chipnet; mainnet only from day 6 with the caps in §10.1.
>
> Hackathon: **BCH BLAZE 2026, Mainnet Track.** Hacking runs **14 Nov 14:00 UTC → 22 Nov 14:00 UTC**. Do not commit project code before kick-off (rules: project must be built during the hackathon). Before then, only read docs, verify the open questions in §15, and set up tooling.
>
> **Build in phases (§11).** Complete one phase at a time. At the end of each phase, **stop**, post a Phase Report, and wait for the builder to reply "proceed" before starting the next phase. Never start a later phase early.
>
> Wallet integration: **WizardConnect only** (XO and Nostr are out of scope unless the core is finished early).

---

## 1. Product in one paragraph

A sender drops a "red envelope" of BCH into any group chat as a link. The first **N** people to open it claim a share — **equal**, **lucky** (random amounts) or **quiz** (answer a question to unlock). Funds sit in an on-chain contract, so **nobody can revoke it before expiry** — not even the sender — and anything unclaimed **automatically returns** after expiry. Claimers need **zero BCH**, sign nothing, and every claimer also receives a **collectible CashToken "stamp" NFT** proving they caught it. **Brands and BCH projects run Sponsored Drops** to put BCH into new hands and get an **on-chain-verifiable report of how many brand-new wallets they onboarded and what each one cost** — the business. Claimers can **"pass it on"** with one tap, so every drop can spawn more drops.

## 2. Hard requirements from the hackathon (must all be true at submission)

| Requirement | How Hongbao meets it |
|---|---|
| A feature where judges can easily make a useful **BCH mainnet transaction** | Claiming an envelope (judge receives BCH + stamp NFT in seconds); creating / passing on an envelope |
| **WizardConnect** integration for wallet connection | Sender connects + signs the funding tx via WizardConnect; claimer connects via WizardConnect to supply a token-aware receiving address |
| **Live, usable demo** judges open with one click | Hosted frontend + API + keeper, all on mainnet |
| Project built during the hackathon | All code written from 14 Nov |
| Presentation (Widget Factory template), Telegram confirmation, roll call | Outside this session's scope |

## 3. How this design scores on the 2026 rubric (4 × 25%)

| Category | What wins it | Where in this spec |
|---|---|---|
| **Business / investment potential** | A paying customer (sponsors), a clear revenue line (drop fee + paid features), a hard metric nobody else in crypto marketing can show: *cost per new BCH wallet, verifiable on-chain*, a viral loop, seasonal go-to-market | §4, §8.5, §9 |
| **Design & usability** | Claim in < 30 s, zero BCH, no signature, works for people with no wallet yet ("hold my share"), instant 0-conf "money arrived", rich link previews in Telegram/X, human error messages, live feed | §6, §8.6, §9 |
| **Innovation** | Non-revocable group gift links (a community ask); fan-out shares; collectible stamp NFTs minted in the same tx; quiz-gated drops (learn-to-earn without custody); pass-it-on lineage tree; sponsor analytics anyone can audit on-chain | §5, §6, §7 |
| **Technical strength** | Real contract on mainnet, full test matrix, Layla features actually used (P2S and/or loop-based batch refund), server can never move funds, honest security model | §5, §7 |

**Judge fit (inference from their public work):**
- **Elliot Price** (BCH Bull, BCH Alliance — business/adoption): Sponsored Drops, cost-per-new-wallet dashboard, revenue model, GTM.
- **Kallisti** (Selene Wallet — newcomer UX, wrote about BCMR): zero-BCH claim, hold-my-share for wallet-less newcomers, stamps with proper BCMR metadata so they render in wallets.
- **Sayoshi Nakamario** (FundMe, Badgers, BCH University — CashTokens, playful mechanics): stamp NFTs, lucky/quiz modes, pass-it-on chains, a readable contract.

## 4. Business model (the code must support all of this)

**Problem.** BCH's main gap is distribution — getting BCH into new hands (BCH team interview, Aug 2026). Projects and merchants that want users today pay for airdrops that get farmed by existing wallets, and Web2 ad metrics can't be verified.

**Product.** Two tiers on one contract:

| Tier | Who | Price | Features |
|---|---|---|---|
| **Personal** | Anyone gifting friends / groups | Free | Equal & lucky envelopes, stamps, pass-it-on |
| **Sponsored Drops** | BCH projects, merchants, creators, communities, events | **3% drop fee** on funded amount (`SPONSOR_FEE_BPS = 300`), paid on-chain in the funding tx to a treasury address | Brand name, logo, colour and call-to-action link on the claim page and link preview; quiz gating; branded stamp NFT; campaign dashboard (claims, fresh wallets, activated wallets, suspected farms, **cost per activated new wallet**, CTA clicks, pass-it-on reach); CSV export |

**Why the fee can't be skipped (pitch this as a design choice):** every claim needs a per-claim approval signature from the gate (§5.3), and the gate only approves claims on envelopes the API has verified as `ACTIVE` — which requires the treasury fee output in the funding tx. A sponsor who funds the contract without the fee simply gets an envelope nobody can claim from; their funds return to them after expiry. Personal envelopes have `feeBps = 0`.

**The headline metric:** **cost per activated new wallet** = sponsor spend ÷ claimers that are (a) a **fresh wallet** (address had **no on-chain history** before the claim) **and** (b) **activated** — the claimed coins moved again within 7 days, or the claimer passed the envelope on — **and** (c) not flagged as a suspected farm. Every number links to on-chain txids, so a sponsor (or judge) can audit it — a moat no ad network has.

Why not just "new wallets": anyone can generate fresh addresses in seconds, so a fresh wallet is **not** a new person. The dashboard therefore shows three tiers — **fresh wallets → activated wallets → activated & not suspected farm** — and the headline uses the last one. Say this openly in the pitch; it's the answer to "can't farmers fake this?".

**Suspected-farm heuristics** (flag, don't block — sponsors decide): same wallet fingerprint or IP hash across multiple claims in a campaign; ≥ 3 claims within 60 s from one IP hash; claimed coins swept to a common address that also received other claims from the same campaign (detected by the 7-day watcher); claimed funds never moved and wallet never used again.

**Viral loop.** Every claim page ends with "Pass it on" (re-gift part of your share as a new envelope) and "Send your own". Track **viral coefficient** = envelopes spawned per claimed envelope via the lineage tree.

**Go-to-market (for the pitch, not code):** BLAZE participants and BCH projects launching tokens; merchants on BCH payment networks; Telegram communities; seasonal spikes — Christmas, Lunar New Year (red envelopes are the tradition; WeChat's digital red envelopes are widely credited with jump-starting WeChat Pay — verify figures before quoting), Eid, Diwali.

**Hackathon traction:** run a real demo campaign ("BLAZE Drop") with a small part of the budget and show its live dashboard in the presentation.

## 5. Smart contract

Language: **CashScript** (latest; v0.13/v0.14 added loops, functions, bitwise and P2S support for the 2026 Layla upgrade — verify syntax). **Layla must be genuinely used:** deploy as **P2S** if CashScript can spend it cleanly; **and** implement the loop-based `refundBatch()` (core, not stretch) so the "built on Layla" claim is true either way.

### 5.1 Key design: fan-out shares + stamp NFTs in one funding tx

The sender's funding tx is also a **CashToken genesis tx**: it creates **N share outputs** locked to the contract, and **each share carries one immutable NFT** of a new category (the envelope's **stamp collection**, commitment = `envelopeIndex(4 bytes) || shareIndex(1 byte)`). Each claim spends exactly one share and delivers its BCH + stamp to the claimer.

Why: claims run **in parallel** (no race on one UTXO), the contract stays tiny, **lucky mode is free** (sender's browser picks random share sizes), and stamps cost nothing extra (the token output's dust is part of the share value the claimer receives).

Notes:
- CashTokens genesis rule: the new category id = txid of the outpoint spent by **input 0**, and that outpoint must have **output index 0**. The browser must pick a sender UTXO at vout 0, or first make a one-input/one-output "prep" tx to self (costs ~$0.001).
- Include a **BCMR OP_RETURN** output in the funding tx pointing at `https://<api>/bcmr/<category>.json` (hash + URI) so wallets show the stamp's name and image.
- Stamps are optional per envelope (`withStamps`, default true). Without stamps the funding tx is a plain multi-output tx.
- **Stamp fallback (decision point: end of day 2).** If by the end of day 2 a WizardConnect wallet (Paytaca or Cashonize) cannot sign the genesis funding tx on Chipnet — or the vout-0 rule / token-aware addresses can't be handled cleanly — set `ENABLE_STAMPS=false`, move stamps to §12 Stretch, and ship envelopes without them. Everything else (contract, gate, sponsors, analytics) must work with stamps off, and the test matrix already covers BCH-only shares. Don't let stamps block the core.

### 5.2 Constructor parameters (one contract instance per envelope)

| Param | Type | Purpose |
|---|---|---|
| `linkPk` | `pubkey` | Public key of the **link secret**. Secret lives only in the URL fragment (`#k=`), never sent to the server |
| `gatePk` | `pubkey` | Server "gate" key that approves fair claims (per-envelope derived key, §8.3) |
| `refundLockingBytecode` | `bytes` | Sender's refund destination |
| `expiry` | `int` | Unix timestamp (≥ 500,000,000) after which refunds are allowed |
| `maxFee` | `int` | Max sats the envelope may spend on network fee per input |

### 5.3 Functions (draft — refine against current CashScript docs)

```solidity
pragma cashscript ^0.14.0;

contract Hongbao(
    pubkey linkPk,
    pubkey gatePk,
    bytes refundLockingBytecode,
    int expiry,
    int maxFee
) {
    // Claim one share. Needs BOTH the link secret AND the gate's approval bound to this
    // exact recipient + this exact share. Server alone can't drain (no link secret);
    // a link holder alone can't drain (no per-claim gate approvals).
    function claim(sig linkSig, datasig gateSig) {
        require(tx.inputs.length == 1);
        require(tx.outputs.length == 1);
        require(checkSig(linkSig, linkPk));

        bytes recipient = tx.outputs[0].lockingBytecode;
        bytes outpoint = tx.inputs[this.activeInputIndex].outpointTransactionHash
                       + bytes4(tx.inputs[this.activeInputIndex].outpointIndex);
        require(checkDataSig(gateSig, recipient + outpoint, gatePk));

        // Envelope pays its own fee; claimer gets everything else
        require(tx.outputs[0].value >= tx.inputs[this.activeInputIndex].value - maxFee);

        // Stamp NFT (or any token) must go to the claimer unchanged
        require(tx.outputs[0].tokenCategory == tx.inputs[this.activeInputIndex].tokenCategory);
        require(tx.outputs[0].nftCommitment == tx.inputs[this.activeInputIndex].nftCommitment);
        require(tx.outputs[0].tokenAmount == tx.inputs[this.activeInputIndex].tokenAmount);
    }

    // After expiry ANYONE can refund many shares in one tx (Layla loops).
    // All inputs must be shares of this same contract; everything goes to the sender.
    function refundBatch() {
        require(tx.time >= expiry);
        require(tx.outputs.length == tx.inputs.length);   // one refund output per share (keeps tokens separate)
        bytes self = tx.inputs[this.activeInputIndex].lockingBytecode;
        int i = 0;
        do {
            require(tx.inputs[i].lockingBytecode == self);
            require(tx.outputs[i].lockingBytecode == refundLockingBytecode);
            require(tx.outputs[i].value >= tx.inputs[i].value - maxFee);
            require(tx.outputs[i].tokenCategory == tx.inputs[i].tokenCategory);
            require(tx.outputs[i].nftCommitment == tx.inputs[i].nftCommitment);
            require(tx.outputs[i].tokenAmount == tx.inputs[i].tokenAmount);
            i = i + 1;
        } while (i < tx.inputs.length);
    }
}
```

Notes:
- `bytes4(...)` encoding of `outpointIndex` must match exactly what the gate signs (little-endian 4 bytes) — test it.
- Confirm how CashScript compares `tokenCategory` / `nftCommitment` / `tokenAmount` on inputs **without** tokens (both sides empty / 0).
- `tokenCategory` in CashScript includes the capability byte for NFTs — confirm, so capability can't be upgraded.
- Every input runs `refundBatch()` and re-checks all pairs: fine for ≤ ~20 shares; cap batch size in the keeper.
- If loop syntax differs (`do…while` vs `for`), use what the current compiler supports. If loops can't be made to work, fall back to a single-share `refund()` and rely on P2S for the Layla claim.
- Claims after `expiry` are not blocked on-chain (script can't enforce "before"); the **gate refuses** after expiry and the keeper refunds promptly. Say this openly.

### 5.4 Contract test matrix (must all pass before mainnet)

`MockNetworkProvider` + Vitest.

| # | Case | Expected |
|---|---|---|
| 1 | Valid claim, BCH-only share | ✅ |
| 2 | Valid claim, share with stamp NFT | ✅ |
| 3 | Claim with wrong link key | ❌ |
| 4 | Gate sig for a different recipient | ❌ |
| 5 | Gate sig for a different share (replay) | ❌ |
| 6 | Fee > maxFee | ❌ |
| 7 | Claim with 2 outputs (skimming) | ❌ |
| 8 | Claim spending 2 shares in one tx | ❌ |
| 9 | Claim that drops / changes the NFT (category, capability, commitment) | ❌ |
| 10 | Refund before expiry | ❌ |
| 11 | Batch refund of 1 share after expiry | ✅ |
| 12 | Batch refund of 5 shares (with NFTs) after expiry | ✅ |
| 13 | Batch refund to any other address | ❌ |
| 14 | Batch refund mixing in an input from another contract | ❌ |
| 15 | Batch refund with fewer outputs than inputs / reordered NFTs | ❌ |
| 16 | Batch refund with fee > maxFee | ❌ |

## 6. Transactions

### 6.1 Create (funding) — built in the **sender's browser**, signed via WizardConnect

1. Browser generates the **link keypair** locally (libauth); sends only `linkPk`.
2. `POST /envelopes` → API validates (budget caps §10.1, sponsor/quiz fields), derives `gatePk`, computes the contract address, returns it plus `requiredOutputs` (treasury fee output for sponsored drops, BCMR OP_RETURN when stamps are on).
3. Browser fetches the sender's UTXOs (WizardConnect session xpub + Fulcrum), ensures input 0 is a vout-0 outpoint (or makes the prep tx), builds the funding tx: N share outputs (each with a stamp NFT if enabled) + required outputs + change. Sends a WizardConnect sign request.
4. Wallet signs → broadcast → browser `POST /envelopes/:id/funded {txid}`.
5. API **verifies on-chain**: share outputs, amounts, contract script, stamp category/commitments, treasury fee output (sponsored), BCMR output. Only then → `ACTIVE`. The gate never approves claims on an unverified envelope, so the sponsor fee is enforced in practice.

Share link: `https://<app>/e/<envelopeId>#k=<linkSecretWIF>` — the fragment never reaches the server. Short form for chat: `https://<app>/<slug>#k=…` (`slug` = 6-char code).

### 6.2 Claim — claimer's browser, no wallet signature

1. Claimer opens link. Three entry paths:
   - **Has a wallet:** connects via WizardConnect → token-aware address.
   - **No wallet yet:** taps "Hold my share" → `POST /envelopes/:id/holds` reserves a share for **15 min** and returns a `holdToken` (stored in localStorage). UI shows Paytaca / Cashonize install links; returning to the link finishes the claim with the token.
   - **Paste address** fallback.
2. Quiz envelopes: claimer submits `answer`; gate checks it (§8.2).
3. `POST /envelopes/:id/claims {recipientAddress, walletFingerprint?, holdToken?, answer?}` → gate checks eligibility, **reserves** a share (row lock, TTL 120 s), signs the datasig, checks whether the recipient address has **any prior on-chain history** (Fulcrum `blockchain.scripthash.get_history`) → stores `isNewWallet`, returns approval.
4. Browser builds the claim tx with CashScript (input = share, output = recipient incl. NFT, unlock `claim(linkSig, gateSig)`), then `POST /claims/:id/broadcast {rawTx}`. API broadcasts; **0-conf acceptance = success** → UI shows "money arrived" immediately.
5. Watcher confirms the spend → `CLAIMED`. Reservation timeout → share back to `AVAILABLE`.

### 6.3 Pass it on

After a successful claim, the claimer can create a new envelope funded from their wallet (WizardConnect sign, same as 6.1) with `parentEnvelopeId` set. Default suggestion: re-gift 50% into 3 shares. The lineage tree powers the "this drop reached X people across Y generations" view and the viral coefficient.

### 6.4 Refund — keeper (no keys)

Every minute: group expired `AVAILABLE` / expired-`RESERVED` shares per envelope (max 20 per tx) → build `refundBatch()` tx (locktime = now, non-final sequence) → broadcast → `REFUNDED`. Emit an event so the sender sees "₿x returned to you".

## 7. Innovation features — what each one is and why it's new

| Feature | What's novel | Backend work |
|---|---|---|
| Non-revocable group links | Answers the Bitcoin Cash Research ask for censorship-resistant shareable on-chain links; existing gift links (CashStamps) are one-recipient and revocable | Contract + gate |
| Stamp NFTs minted in the funding tx | Every claim is a collectible "I caught it" proof with zero extra transactions; sponsors get branded collectibles | Genesis rules, BCMR endpoint, verification |
| Quiz-gated drops | Learn-to-earn without custody: sponsors teach something about their product, answer unlocks the BCH | Hashed answers in gate |
| Pass-it-on lineage | Gifts that propagate; measurable viral coefficient on-chain | `parentEnvelopeId`, tree endpoint |
| On-chain-auditable sponsor analytics | "Cost per new wallet" where every claim links to a txid — verifiable marketing | Stats service, history lookup |
| Loop-based batch refunds (Layla) | Showcases 2026 upgrade features in a consumer app | Contract + keeper |

## 8. Backend (NestJS + Prisma + PostgreSQL, TypeScript)

### 8.1 Modules

- `EnvelopesModule` — create, read, funded-verification, slugs, lineage.
- `ClaimsModule` — gate logic, holds, reservations, approvals, broadcast.
- `CampaignsModule` — sponsors, campaign grouping, analytics, CSV export.
- `StampsModule` — stamp metadata, BCMR JSON, stamp images.
- `ChainModule` — Fulcrum/Electrum client (WSS), subscriptions, history lookups, broadcast, tx parsing.
- `KeeperModule` — batch refunds, reservation/hold cleanup, 7-day activation checks.
- `MediaModule` — Open Graph link-preview images.
- `PriceModule` — BCH/USD (cached 60 s, fallback to last known).
- `KeysModule` — gate key derivation.
- `BudgetModule` — caps and spend ledger (§10.1).

### 8.2 Gate eligibility rules

- One claim per **recipient address**, per **wallet fingerprint** (hash of WizardConnect xpub) and per **hold token** per envelope.
- Rate limit per IP per envelope (claims and quiz attempts: max 5 wrong answers / 10 min).
- Quiz: stored as `sha256(salt || normalize(answer))` (normalize = trim, lowercase, collapse spaces); up to 3 accepted answers.
- Refuse after expiry, when no shares are available, or when the envelope isn't `ACTIVE`.
- **Honest limit:** doesn't stop someone with many wallets. For sponsored drops, the "new wallet" metric and per-IP limits make farming visible; future: Telegram/Nostr identity gates. Say so in the pitch.

### 8.3 Gate key

Master seed in env (`GATE_MASTER_SEED`), never logged. Per-envelope child key (index = envelope sequence). The gate key alone **cannot** move funds and can only authorize a specific share to a specific recipient.

### 8.4 Data model (Prisma, sketch)

```prisma
model Sponsor {
  id          String     @id @default(cuid())
  name        String
  logoUrl     String?
  brandColor  String?    // hex
  ctaLabel    String?
  ctaUrl      String?
  adminToken  String     @unique   // hashed; for dashboard access
  campaigns   Campaign[]
}

model Campaign {
  id        String     @id @default(cuid())
  sponsorId String
  sponsor   Sponsor    @relation(fields: [sponsorId], references: [id])
  name      String
  createdAt DateTime   @default(now())
  envelopes Envelope[]
}

model Envelope {
  id                    String   @id @default(cuid())
  seq                   Int      @unique @default(autoincrement()) // gate key index
  slug                  String   @unique
  network               Network  // CHIPNET | MAINNET
  senderAddress         String
  refundLockingBytecode String
  linkPk                String
  contractAddress       String
  expiry                Int
  maxFee                Int
  mode                  Mode     // EQUAL | LUCKY | QUIZ
  quizQuestion          String?
  quizAnswerHashes      String[]
  quizSalt              String?
  withStamps            Boolean  @default(true)
  stampCategory         String?
  totalSats             BigInt
  shareCount            Int
  message               String?
  theme                 String?  // e.g. classic-red, gold, christmas, lunar
  campaignId            String?
  campaign              Campaign? @relation(fields: [campaignId], references: [id])
  feeBps                Int      @default(0)
  parentEnvelopeId      String?
  parent                Envelope?  @relation("Lineage", fields: [parentEnvelopeId], references: [id])
  children              Envelope[] @relation("Lineage")
  fundingTxid           String?
  status                EnvelopeStatus // PENDING_FUNDING | ACTIVE | EXHAUSTED | EXPIRED | REFUNDED
  ctaClicks             Int      @default(0)
  createdAt             DateTime @default(now())
  shares                Share[]
  claims                Claim[]
}

model Share {
  id             String   @id @default(cuid())
  envelopeId     String
  envelope       Envelope @relation(fields: [envelopeId], references: [id])
  index          Int
  outpointTxid   String
  outpointIndex  Int
  sats           BigInt
  nftCommitment  String?
  status         ShareStatus // AVAILABLE | HELD | RESERVED | CLAIMED | REFUNDED
  reservedUntil  DateTime?
  holdToken      String?  @unique
  spendTxid      String?
  @@unique([outpointTxid, outpointIndex])
}

model Claim {
  id                String   @id @default(cuid())
  envelopeId        String
  envelope          Envelope @relation(fields: [envelopeId], references: [id])
  shareId           String?  @unique
  recipientAddress  String
  walletFingerprint String?
  ipHash            String?
  isNewWallet       Boolean? // "fresh wallet": no on-chain history before claim
  activatedWithin7d Boolean? // claimed coins moved again within 7 days, or claimer passed it on
  suspectedFarm     Boolean  @default(false)
  farmReasons       String[] // e.g. SAME_FINGERPRINT, IP_BURST, COMMON_SWEEP, NEVER_USED
  claimTxid         String?
  status            ClaimStatus // APPROVED | BROADCAST | CONFIRMED | EXPIRED
  createdAt         DateTime @default(now())
  @@unique([envelopeId, recipientAddress])
}

model LedgerEntry {          // §10.1 spend ledger
  id        String   @id @default(cuid())
  kind      LedgerKind // FUND | CLAIMED | REFUNDED | FEE
  sats      BigInt
  usd       Decimal
  txid      String
  createdAt DateTime @default(now())
}
```

### 8.5 REST API (contract for the frontend session)

**Envelopes & claims**

| Method & path | Body | Returns |
|---|---|---|
| `POST /envelopes` | `{senderAddress, linkPk, shareCount, mode, totalSats, expiry, message?, theme?, withStamps?, quiz?: {question, answers[]}, campaignId?, sponsorToken?, parentEnvelopeId?}` | `{id, slug, contractAddress, gatePk, constructorArgs, requiredOutputs[], minShareSats, shareAmounts? (suggested lucky split)}` |
| `POST /envelopes/:id/funded` | `{txid}` | `{status, shares[]}` after on-chain verification |
| `GET /envelopes/:id` (or `/s/:slug`) | — | Public view: message, theme, sponsor branding, mode, quiz question, total & remaining (sats + USD), shares claimed/left, expiry countdown, recent claims (truncated address, amount, **luckiest** flag, isNewWallet), stamp image |
| `POST /envelopes/:id/holds` | `{fingerprint?}` | `{holdToken, heldUntil}` |
| `POST /envelopes/:id/claims` | `{recipientAddress, walletFingerprint?, holdToken?, answer?}` | `{claimId, share, gateSig, constructorArgs}` or error (§8.6) |
| `POST /claims/:id/broadcast` | `{rawTx}` | `{txid, amountSats, amountUsd, stamp}` |
| `GET /envelopes/:id/events` | — | SSE: `claimed`, `held`, `refunded`, `exhausted`, `passedOn` |
| `GET /envelopes/:id/tree` | — | Pass-it-on lineage: nodes, generations, total reach, viral coefficient |
| `POST /envelopes/:id/cta-click` | — | 204 (counts sponsor CTA clicks) |

**Sponsors & analytics**

| Method & path | Body | Returns |
|---|---|---|
| `POST /sponsors` | `{name, logoUrl?, brandColor?, ctaLabel?, ctaUrl?}` | `{sponsorId, sponsorToken}` (shown once) |
| `POST /campaigns` (sponsor token) | `{name}` | `{campaignId}` |
| `GET /campaigns/:id/stats` (sponsor token) | — | `{spentSats, spentUsd, feesUsd, claims, freshWallets, activatedWallets, suspectedFarms, activatedNotFarm, costPerActivatedNewWalletUsd, costPerFreshWalletUsd, ctaClicks, ctr, passOnEnvelopes, totalReach, perEnvelope[], claimTxids[]}` |
| `GET /campaigns/:id/export.csv` (sponsor token) | — | Claim-level CSV with txids |
| `GET /campaigns/:id/public` | — | Public, shareable version of the stats (no addresses) — "proof of reach" |

**Media, stamps, ops**

| Method & path | Returns |
|---|---|
| `GET /og/:id.png` | 1200×630 link-preview card: theme, sponsor logo, message, "3 of 5 left · $0.30" (satori/@vercel/og or resvg). Set as `og:image` so Telegram/X unfurl beautifully |
| `GET /bcmr/:category.json` | BCMR metadata for the stamp collection (name, description, icon, per-NFT name "Hongbao Stamp #n") |
| `GET /stamps/:category/:commitment.svg` | Stamp artwork (generated SVG: theme, envelope name, number) |
| `GET /stats/global` | Public: total envelopes, claims, new wallets onboarded, BCH gifted (for landing page + pitch) |
| `GET /health` | Chain connection, keeper last run, network |
| `GET /admin/budget` (admin token) | Spend ledger summary (§10.1) |
| `POST /admin/demo/refill` (admin token) | Judge-demo envelope status |

Validate every body with Zod (shared schema package reused by the frontend).

### 8.6 Error catalog (human copy the frontend can show as-is)

| Code | HTTP | Message |
|---|---|---|
| `ENVELOPE_EMPTY` | 410 | "Too slow! All the red envelopes have been grabbed." |
| `ENVELOPE_EXPIRED` | 410 | "This envelope has expired — the BCH went back to the sender." |
| `ALREADY_CLAIMED` | 409 | "You've already grabbed one from this envelope 🧧" |
| `WRONG_ANSWER` | 403 | "Not quite — try again." (includes `attemptsLeft`) |
| `RATE_LIMITED` | 429 | "Slow down a little and try again in a minute." |
| `HOLD_EXPIRED` | 410 | "Your held share was released. Grab another if any are left!" |
| `NOT_FUNDED` | 409 | "This envelope isn't ready yet — ask the sender to finish sending it." |
| `BUDGET_CAP` | 422 | "Demo limit reached for this envelope size." |
| `CHAIN_UNAVAILABLE` | 503 | "The network is busy — your share is still saved, try again shortly." |

## 9. Usability requirements the backend must guarantee

- **Claim latency:** API approval < 500 ms; broadcast + 0-conf acceptance shown immediately (no waiting for blocks).
- **Lucky reveal data:** amounts and a `luckiest` flag in the public view so the UI can celebrate.
- **Fiat everywhere:** every amount returned in sats + USD.
- **Slugs + OG images** so links look great when pasted in Telegram / X / WhatsApp.
- **Hold my share** for wallet-less newcomers (15 min).
- **Graceful chain outages:** reservations survive; claimer can retry without losing their place.
- **Themes:** `classic-red`, `gold`, `christmas`, `lunar` (used by OG images and stamps; the frontend styles to match).
- **Accessibility:** OG and stamp images include alt text in the API response.

## 10. Infrastructure

- **Networks:** develop on **Chipnet**, demo on **mainnet**. `NETWORK` env (default `CHIPNET`). Chipnet faucets: tbch.googol.cash, chipnet.bch.ninja.
- **Chain access:** public Fulcrum servers over WSS with a fallback list; `electrum-cash` client or CashScript's `ElectrumNetworkProvider`.
- **Hosting (free tiers):** API + keeper on a free tier with free Postgres (Neon/Supabase); frontend on Vercel. Keeper in-process. Keep everything on free tiers — no paid services within the $5 budget.
- **No cold starts during judging (22–28 Nov).** Many free tiers sleep when idle (Render's free web services spin down after ~15 min and take tens of seconds to wake) — a judge's first click would hang and the keeper would stop refunding. Prefer a free host that doesn't sleep; otherwise run a free uptime monitor (e.g. UptimeRobot / cron-job.org) hitting `GET /health` every 5 min from submission until results on 28 Nov. `GET /health` must be cheap and also report keeper last-run time so a stalled keeper is visible.
- **Config:** `DATABASE_URL`, `GATE_MASTER_SEED`, `NETWORK`, `FULCRUM_URLS`, `ADMIN_TOKEN`, `TREASURY_ADDRESS`, `SPONSOR_FEE_BPS`, `ENABLE_STAMPS`, `PUBLIC_API_URL`, `PRICE_API_URL`, plus budget caps (§10.1). Never commit or log secrets.
- **Observability:** structured logs for approvals, broadcasts, refunds (with txids).

### 10.1 Budget constraints ($5 hard cap — non-negotiable)

The builder can spend **at most $5 of real money in total**. Fees are negligible (~1 sat/byte ≈ $0.001 per tx); what costs money is **shares that get claimed**.

| Use | Amount | Recoverable? |
|---|---|---|
| Mainnet testing (days 6–7 only) | $1.00 | Mostly — unclaimed shares refund after expiry |
| Judges' demo envelopes | $1.50 | No, once claimed |
| "BLAZE Drop" demo campaign + Community Choice drops | $1.50 | No |
| Buffer | $1.00 | Unused part stays |

**Rules the code must enforce**

1. **Chipnet by default**; mainnet only via explicit `NETWORK=MAINNET`, from day 6. All automated / e2e scripts run on Chipnet.
2. **Server-side mainnet caps** in `POST /envelopes` (422 on violation): `MAX_ENVELOPE_USD = 0.50` (fallback `MAX_ENVELOPE_SATS`, e.g. 200,000), `MAX_SHARES = 10`, `MAX_ACTIVE_MAINNET_SATS` (~600,000), `DAILY_MAINNET_SATS` (~400,000).
3. **Small shares by default:** ~$0.05–$0.10 on mainnet; enforce `minShareSats` (dust floor; token outputs need more — §15).
4. **Short expiries allowed:** `MIN_EXPIRY_SECONDS = 600`; default test expiry 15–30 min.
5. **Refill one at a time** for the judge-demo envelope (`POST /admin/demo/refill`).
6. **Dedicated demo wallet** holding only the budget.
7. **Spend ledger** (`LedgerEntry`) + `GET /admin/budget` → `{lockedSats, claimedSats, refundedSats, spentUsdTotal, remainingBudgetUsd}`; warn at 80%.
8. **Sponsor fee in demos:** the treasury is your own address, so fee outputs aren't lost — count them as recoverable in the ledger.
9. **PUSD envelopes are out of scope** (would cost extra to acquire).

## 11. Build plan — phases with review checkpoints (14–22 Nov)

### 11.1 Checkpoint protocol (follow exactly)

1. Work on **one phase at a time**, in order. Don't write code for a later phase, even "while you're there".
2. When a phase's exit criteria are met, **stop** and post a **Phase Report** (template below). Then wait.
3. Continue only after the builder explicitly replies **"proceed"** (or "proceed with changes: …"). Silence or questions are not approval.
4. If the builder requests changes, make them inside the **same** phase, post an updated report, and wait again.
5. If you hit a blocker or must deviate from this spec mid-phase (a library doesn't support something, a design decision is needed, a cap would be exceeded), **stop early** and ask — don't improvise around it.
6. Each phase ends with a git commit and a tag `phase-N` so the builder can diff phases (`git diff phase-2 phase-3`).
7. Never spend mainnet funds before Phase 8, and never above the §10.1 caps.
8. Keep phases reviewable: prefer small, readable files with comments on anything BCH-specific (script, sighash, token rules).

**Phase Report template**

```
## Phase N complete — <name>

### What was built
- …

### Files added / changed
- path — one-line purpose

### How to check it yourself
- commands to install / run / test (copy-paste ready)
- what you should see

### Results
- tests: X passed / Y total (paste summary)
- Chipnet / mainnet txids with explorer links (if any)
- budget ledger (from Phase 8 on)

### Deviations from the spec
- what changed and why (or "none")

### Decisions I need from you
- … (or "none")

### Known issues / TODOs carried forward
- …

### Next: Phase N+1 — <name>
- one-paragraph preview

Reply "proceed" to continue.
```

### 11.2 Phases

| Phase | Name | Scope | Exit criteria (all required) | What you should review | Target day |
|---|---|---|---|---|---|
| **0** | Verify & set up | Answer every §15 open question with evidence (docs links, tiny experiments). Monorepo scaffold: `packages/contract`, `packages/shared` (Zod schemas, types), `apps/api`, `scripts/`; TypeScript, Vitest, lint, `.env.example`. No product logic yet. | §15 answered in a `docs/findings.md`; repo builds and an empty test runs; P2S and loop support decided (yes/no + plan) | `docs/findings.md` — especially P2S, loops, WizardConnect genesis support, dust limits. Agree with the decisions before contract work starts | Day 1 (after kick-off) |
| **1** | Smart contract | `Hongbao.cash` (`claim`, `refundBatch`), compile, full 16-case test matrix on `MockNetworkProvider`, contract README explaining every require line | All 16 tests pass; compiled artifact committed; README written | Read the contract line by line against §5.3; run `pnpm test` in `packages/contract`; check the negative tests really fail for the right reason | Day 1–2 |
| **2** | Transactions on Chipnet + stamp go/no-go | Scripts in `scripts/` that build and broadcast on **Chipnet**: funding (with and without stamps, BCMR OP_RETURN, vout-0 prep), claim (link key + gate datasig), batch refund. Test signing the funding tx through a real WizardConnect wallet. **Decide `ENABLE_STAMPS`** (§5.1) | Chipnet txids for: funding, 2 claims, batch refund (explorer links); stamp go/no-go recorded with reason | Open each txid on a Chipnet explorer; confirm amounts, NFT commitments, refund address; agree with the stamp decision | Day 2 |
| **3** | API foundation | NestJS app, Prisma schema (§8.4) + migrations, `ChainModule`, `KeysModule`, `PriceModule`, `BudgetModule` caps, `POST /envelopes`, `POST /envelopes/:id/funded` (on-chain verification incl. sponsor fee output), `GET /envelopes/:id`, slugs, `/health`, Zod validation, error catalog (§8.6) | Script creates an envelope via the API on Chipnet and it becomes `ACTIVE` only after verification; caps reject oversize mainnet requests in tests | Schema, verification logic (does it check every output?), cap tests, error responses | Day 3 |
| **4** | Claims & gate | Gate rules (equal / lucky / quiz), holds, reservations with TTL, datasig signing, `POST /claims/:id/broadcast`, fresh-wallet detection, rate limits, farm-flag inputs (fingerprint, IP hash) | Chipnet e2e script: 3 parallel claims succeed, 4th on a 3-share envelope gets `ENVELOPE_EMPTY`, hold → claim works, quiz right/wrong, double-claim rejected | Gate code (the security core): what it signs, eligibility checks, race conditions on reservations | Day 4 |
| **5** | Lifecycle & live data | Keeper: batch refunds, reservation/hold cleanup, 7-day activation watcher, farm-flag heuristics; SSE events; pass-it-on (`parentEnvelopeId`) + `/tree` | Chipnet: expired envelope auto-refunds in one batch tx; SSE stream shows claim events; tree endpoint returns a 2-generation chain | Keeper safety (can it ever refund early or to the wrong place?), event payloads | Day 5 |
| **6** | Media & stamps metadata | `/og/:id.png` link-preview cards with themes, `/bcmr/:category.json`, `/stamps/...svg`, alt text | OG card renders for each theme (screenshots in report); a Chipnet stamp shows name/image in Paytaca or Cashonize (or noted if stamps are off) | Look at the images; check the BCMR JSON | Day 5 |
| **7** | Sponsors & analytics | `Sponsor`, `Campaign`, sponsor tokens, `/campaigns/:id/stats` (fresh → activated → not-farm funnel, cost per activated new wallet), CSV export, public proof-of-reach, `/stats/global`, CTA clicks | Seeded Chipnet campaign shows correct numbers in stats, CSV and public page; numbers reconcile with txids | Metric definitions match §4; fee enforcement; nothing private leaks on the public page | Day 6 |
| **8** | Deploy & mainnet | Deploy API + Postgres on free tiers; uptime monitor plan; `NETWORK=MAINNET` with §10.1 caps; spend ledger + `/admin/budget`; tiny real envelopes; judge-demo refill endpoint | Mainnet funding, claim and batch-refund txids recorded; `/admin/budget` shows < $1 spent; `/health` green on the public URL | Ledger numbers vs your wallet; caps actually enforced on the live URL | Day 6–7 |
| **9** | Integration & submission support | Fixes from the frontend session, CORS, final e2e from a cold phone browser, "BLAZE Drop" demo campaign, export stats for slides, start uptime monitor, README for judges | Judges' path works end-to-end on mainnet from a phone; monitor running; README done | Try the full flow yourself on your phone before submitting | Day 7–8 (submit before 22 Nov 14:00 UTC) |

If a phase overruns its target day, say so in its report and propose what to cut (first candidates: Phase 6 stamp artwork polish, pass-it-on tree UI data, CSV export).

## 12. Stretch (only if everything above is done)

1. **PUSD envelopes** (sponsor alignment) — only if budget allows.
2. **Send to a Nostr npub.**
3. **XO template** of the contract (General Protocols bounty).
4. **Scheduled drops** (envelope opens at a set time — e.g. midnight on New Year).

## 13. Pitch facts to keep handy

- **"Cost per activated new wallet, verifiable on-chain"** — the sponsor metric; show the live BLAZE Drop dashboard with the fresh → activated → not-farm funnel.
- **"Can farmers fake it?"** — fresh wallets are cheap, so we only count wallets that actually use the BCH and aren't flagged as farms; every claim links to a txid.
- **"Can sponsors skip the fee?"** — no: claims need the gate's approval, and the gate only serves envelopes that paid the fee on-chain.
- Built on the **Layla upgrade** (P2S and/or loop-based batch refunds), live on **mainnet**.
- **Non-custodial:** server can't move funds without the link secret; link holder can't drain without per-claim approval; sender can't revoke early; refunds can only go to the sender. If the server disappears, the worst case is that claims pause — funds still return.
- **Zero BCH, zero signatures to claim; money arrives instantly (0-conf).**
- **Every claim = a collectible stamp NFT**, minted in the same tx, visible in wallets via BCMR.
- **Pass it on:** one drop reached X people across Y generations (use real numbers).
- Revenue: **3% fee on Sponsored Drops**, free for personal use.

## 14. Security & honesty notes for the pitch

- Sybil: per-address/fingerprint/IP limits; new-wallet flag exposes farming to sponsors; identity gates later.
- Quiz answers can be shared between claimers — fine for engagement, not a security boundary.
- Gate availability is a liveness dependency, not a custody risk.

## 15. Open questions — verify on day 1

1. CashScript version + syntax for: P2S deploy/spend, loops (`do…while`/`for`), `bytes4()`, `tx.time`, token/NFT introspection on non-token inputs, `checkDataSig` message format, capability byte in `tokenCategory`.
2. Can a WizardConnect sign request carry a **genesis** funding tx (N NFT outputs + OP_RETURN + treasury output)? Does the session expose a **token-aware** receive address?
3. Dust minimums for plain outputs vs token outputs → `minShareSats`.
4. Realistic claim / batch-refund tx sizes → `maxFee`.
5. BCMR: correct OP_RETURN format (hash + URI) and whether Paytaca/Cashonize pick it up for a new category.
6. Reliable Fulcrum WSS servers for mainnet + Chipnet; whether `get_history` is enabled.
7. Free-tier host that allows outbound WSS and long-running processes (keeper, SSE).
8. Confirm in Telegram whether scaffolding before kick-off is allowed (default: no).

## 16. References

- BLAZE rules & judging: https://dorahacks.io/hackathon/bchblaze2026/ · tracks: https://dorahacks.io/hackathon/bchblaze2026/tracks · site: https://bchblaze.cash/
- Community ask for on-chain shareable links: https://bitcoincashresearch.org/t/shareable-links-as-on-chain-contracts/1455
- BCH team on distribution being the main gap: https://letsexchange.io/blog/price-is-the-least-interesting-metric-interview-with-the-bitcoin-cash-team/
- WizardConnect protocol: https://wizardconnect-456f57.gitlab.io/protocol · connection URI: https://wizardconnect-456f57.gitlab.io/connection-uri
- CashScript WalletConnect/WizardConnect guide: https://cashscript-4x1oat3xw-lahana.vercel.app/docs/guides/walletconnect (also cashscript.org)
- CashTokens & BCMR specs: https://cashtokens.org · https://github.com/bitjson/chip-bcmr
- Layla upgrade overview: https://coinmarketcap.com/cmc-ai/bitcoin-cash/latest-updates/
- Existing similar product to differentiate from: CashStamps https://stamps.cash
