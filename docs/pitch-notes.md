# Pitch notes: Hongbao Drops at BCH BLAZE 2026

Talking points for the Widget Factory slides and the judges' Q&A. The framing is complementary: CashStamps (a BLAZE sponsor) and Hongbao Drops solve different gifting moments, and both bring new people to Bitcoin Cash.

## 1. Two gifting moments, two tools

"Gifting one friend, maybe on paper? CashStamps is perfect. Dropping into a group of 50? That's a Hongbao."

CashStamps turns each gift into its own printable wallet for one recipient: great for a card, a classroom or a meetup table. Hongbao is one link for a whole group chat, where the first N people to open it each get a share. If someone asks "isn't this the same as CashStamps?", the answer is: no, it's the group version, and we'd happily point a one-to-one gift their way.

## 2. The rules live on-chain

The BCH sits in a contract (the "lockbox"), not with us and not with the sender. Nobody, not even the sender, can take it back before expiry. Leftovers return to the sender automatically after expiry; nobody has to keep a browser open or remember to reclaim. Each claim needs the link's key and our approval, so each person gets one share. Claimers need no BCH and sign nothing.

## 3. Fun that keeps people in the chat

Lucky mode (random amounts, someone is the "luckiest"), quiz mode (answer to open), live claims as they happen, and a Hongbao Seal NFT for every claimer as proof they caught it. Pass it on lets a claimer re-gift part of their share as a new envelope, and the drop tree shows how far one envelope travelled.

## 4. Business: a model sponsors can verify

Sponsored Drops put a brand on the envelope for a 3% fee. The dashboard counts fresh wallets, which of them actually used their BCH or passed it on within 7 days, and suspected farming, giving a cost per activated new wallet. Every number links to on-chain transactions, so a sponsor (or a judge) can check it instead of trusting us. That makes onboarding measurable, which is exactly what both CashStamps-style gifting and Hongbao-style drops are for: getting people their first BCH.

### 4.1 Case study: we were our own first sponsor (BLAZE Drop)

We have no outside sponsor yet, so we ran the sponsor flow on ourselves, on mainnet, through the same API any sponsor uses: sponsor "Hongbao Drops", campaign "BLAZE Drop", created 19 Nov 2026.

| | Value | Source |
|---|---|---|
| Envelopes | 2 (one equal split, one lucky split), 10 shares each, Hongbao Seal on every share | public page |
| Money put in | 200,000 sats (≈ $0.41) | public page `lockedSats` at launch |
| Sponsor fee paid (3%) | 3,000 sats per envelope, 6,000 total | output 11 of each funding tx, to the treasury `bitcoincash:qzrxax7vr0cw0s3ptldqj8302mwnfgeg4uayplk6rf` |
| Funding txids | [a6cd3583…](https://blockchair.com/bitcoin-cash/transaction/a6cd35837022184f937114123806f10421c2cac9465ba11e62c0a7ee038de183) (equal), [db974414…](https://blockchair.com/bitcoin-cash/transaction/db9744140ba5336d7e890baa10bee08d3168b37632e0435cef878c5bb53f8e08) (lucky) | chain |
| Claims | ⟨pending⟩ | public page `claims` |
| Brand-new wallets | ⟨pending⟩ | `freshWallets` |
| Passed on | ⟨pending⟩ | `passOnEnvelopes` |
| Cost per brand-new wallet | ⟨pending⟩ | `costPerFreshWalletUsd` = (BCH given away + sponsor fee) ÷ brand-new wallets |
| Used their BCH within 7 days, not flagged as farming | not available before 26 Nov (the 7-day window is still open during judging) | `activatedNotFarm` |

As of 19 Nov 06:19 UTC the campaign had 0 claims: the links had just been made. Fill the pending rows from the public page on the day:

```bash
curl -s https://hongbao-drops-api.vercel.app/campaigns/cmwn5o8eq000107jtj6ecle68/public
```

Human-readable: https://hongbao-drops.vercel.app/c/cmwn5o8eq000107jtj6ecle68. Every claim, funding and refund on that page links to its transaction.

### 4.2 Live traction during judging

Pitch line, to fill on the day:

> "During judging, **N** people opened a Hongbao on mainnet: **F** of them with a brand-new wallet. They passed **P** envelopes on to others, and **X BCH** (≈ $**U**) went straight from lockboxes into their wallets, with no fee and nothing to sign."

Where the numbers come from. `since` counts only what happened from that moment on, so our own test claims from before judging are left out:

```bash
curl -s "https://hongbao-drops-api.vercel.app/stats/global?since=2026-11-22T14:00:00Z"
```

| Placeholder | Field |
|---|---|
| N | `claims` |
| F | `newWalletsOnboarded` |
| P | `passOnEnvelopes` |
| X / U | `bchGiftedSats` ÷ 100,000,000 / `bchGiftedUsd` |

Without `since`, the same URL gives the all-time mainnet totals (also on the landing page once 5 envelopes have been funded). On 19 Nov 06:30 UTC, before any sharing, those were: 10 envelopes, 9 claims, 5 brand-new wallets, 3 passed on, 27,400 sats gifted. Most of these are our own end-to-end tests, so don't use them as traction. "Used their BCH within 7 days" (`activatedNewWallets`) isn't meaningful until 7 days after a claim; say so if asked.

### 4.3 Unit economics (from our own mainnet transactions)

Price used: $207.43 per BCH (the API's live price, 19 Nov 2026 06:40 UTC). Every fee below is the actual miner fee of a real mainnet transaction (1 sat per byte).

**Miner fees per operation**

| Operation | Example tx | Size | Miner fee | ≈ USD | Who pays |
|---|---|---|---|---|---|
| Claim (Hongbao Seal on 666 sats + plain BCH) | [2c803874…](https://blockchair.com/bitcoin-cash/transaction/2c80387481aeecff19a6c826c82479a8e663a385eb81a4d776ba04e826cf34c5), also [c6806175…](https://blockchair.com/bitcoin-cash/transaction/c6806175b7cd9e633c6b97209816f607f2eac000154227c90a18d6bae1f5f6fd) | 590 B | 590 sats | $0.0012 | Comes out of the share itself (contract: claim outputs ≥ share − `maxFee`) |
| Funding, 10 shares with seals (sponsored, 3% fee output included) | [a6cd3583…](https://blockchair.com/bitcoin-cash/transaction/a6cd35837022184f937114123806f10421c2cac9465ba11e62c0a7ee038de183) | 1,246 B | 1,281 sats | $0.0027 | The sender's wallet |
| Funding, 10 shares with seals (demo, 3 inputs) | [eaa86358…](https://blockchair.com/bitcoin-cash/transaction/eaa863585532ef9190c700d98fb3001787371c86c72b6a5ad91003ddd994a4fd) | 1,494 B | 1,534 sats | $0.0032 | The sender's wallet |
| Funding, 2 shares with seals | [675ddbf8…](https://blockchair.com/bitcoin-cash/transaction/675ddbf80b9293f92c8f09fb6c7bb7ddb052f2c44c0ce205cb739cda0ab1c76b) | 540 B | 540 sats | $0.0011 | The sender's wallet |
| Refund of 1 leftover share | [a4e3a53b…](https://blockchair.com/bitcoin-cash/transaction/a4e3a53bb0f059baaf7ce28dd7106ec26358a0e824427948409c7677aed71c75) | 459 B | 459 sats | $0.0010 | Comes out of the refunded share |
| Refund of many shares in one tx | ⟨pending: demo envelope `gcbxxe` refunds 7 shares in one tx after 19 Nov ≈ 21:15 UTC⟩ | | | | Comes out of the refunded shares |

Every funding also sends a 546-sat identity output to our treasury (it anchors the Hongbao Seal metadata and is never spent).

**What this means for us:** the operator pays **no miner fees at all**. Claim and refund fees come out of the envelope's own coins, and the sender's wallet pays the funding fee. Our running cost is hosting: today Vercel and Neon free tiers plus a free cron-job.org schedule, so $0 a month. Assumption to check before scaling: Vercel's free (Hobby) plan is for non-commercial use, so a business with paying sponsors would move to a paid plan (check current Vercel and Neon pricing; we haven't priced it).

**What a sponsor pays for a 10-share drop**, from the BLAZE Drop envelope above: 100,000 sats to the claimers + 3,000 sats sponsor fee + 546 sats identity output + 1,281 sats funding fee. Up to 10 × 590 sats of claim fees come out of the 100,000. That's ≈ 4.8% overhead on top of the gift, of which 3% is our revenue.

**Revenue: 3% of each sponsored envelope (minimum 546 sats).** Worked example. All drop sizes and volumes below are **assumptions**, not traction:

| Assumption: average sponsored drop | Our fee per drop | 100 drops / month | 1,000 drops / month |
|---|---|---|---|
| $10 (e.g. 20 people × $0.50) | $0.30 | $30 | $300 |
| $50 (e.g. 100 people × $0.50) | $1.50 | $150 | $1,500 |
| $200 (a project's launch drop) | $6.00 | $600 | $6,000 |

Cost to serve per drop for us: $0 in miner fees (see above) plus a share of hosting. The fee is pure margin until hosting needs a paid plan. Caveats to say out loud: the mainnet demo currently caps an envelope at $0.50 and 10 shares (`MAX_ENVELOPE_USD`, `MAX_SHARES`, our own safety limits for the hackathon, configurable per deployment), and personal drops are free and bring no revenue.

### 4.4 Self-serve, and the fee can't be skipped

**From sign-up to a live dashboard without talking to us.** Everything runs on the sponsor page (`/sponsor`):
1. **Sign up:** name, optional logo, brand colour and a call-to-action link. `POST /sponsors` returns a sponsor token once. There's no approval step, only a rate limit of 5 sign-ups per IP per hour ([campaigns.service.ts:48-60](../apps/api/src/campaigns/campaigns.service.ts)).
2. **Create a campaign** with that token (`POST /campaigns`, [campaigns.service.ts:74](../apps/api/src/campaigns/campaigns.service.ts)).
3. **Send a sponsored drop:** the campaign's "New drop" button opens `/send?campaign=<id>` ([Sponsor.tsx:281](../apps/web/src/pages/Sponsor.tsx)). The sender form says "Sponsored drops add a 3% fee (min 546 sats)" ([Send.tsx:436](../apps/web/src/pages/Send.tsx)) and the sponsor funds it from any BCH wallet.
4. **Watch the dashboard:** claims, brand-new wallets, used within 7 days, suspected farming, cost per activated new wallet, a CSV export, and a public proof page `/c/<id>` to share ([Sponsor.tsx:192-287](../apps/web/src/pages/Sponsor.tsx), [campaigns.service.ts:91-97](../apps/api/src/campaigns/campaigns.service.ts)).

Our own BLAZE Drop (§4.1) was set up exactly this way, through the public API, with no manual step on our side.

**Why the 3% can't be routed around.** It's a chain of four checks:
1. **The fee is fixed when the envelope is created.** A valid sponsor token (and a campaign belonging to it) sets `feeBps` to `SPONSOR_FEE_BPS` = 300, and the fee is `max(ceil(3% × total), 546 sats)`, stored with the envelope ([envelopes.service.ts:125-144](../apps/api/src/envelopes/envelopes.service.ts), stored at line 186). A wrong token or someone else's campaign is refused (lines 132, 135).
2. **The funding template includes the fee output to our treasury** ([envelopes.service.ts:241-242](../apps/api/src/envelopes/envelopes.service.ts), placed right after the shares by [packages/contract/src/funding.ts:83](../packages/contract/src/funding.ts)).
3. **The funding check refuses a transaction without it.** If the output after the shares doesn't pay at least the fee, token-free, to the treasury script, the result is `FUNDING_MISMATCH` ([funding-verifier.ts:97-104](../apps/api/src/envelopes/funding-verifier.ts)). Only a transaction that passes is recorded and turns the envelope `ACTIVE` ([envelopes.service.ts:298-334](../apps/api/src/envelopes/envelopes.service.ts)).
4. **The gate signs claims only for active envelopes.** `loadClaimable` refuses `PENDING_FUNDING` with `NOT_FUNDED` ([claims.service.ts:61-65](../apps/api/src/claims/claims.service.ts)), and every claim and hold goes through it (lines 142, 209). The contract itself requires the gate's signature on every claim (`checkDataSig(gateSig, recipient + outpoint, gatePk)`, [Hongbao.cash:40](../packages/contract/contracts/Hongbao.cash)), so nobody can claim an envelope the gate won't sign for.

An envelope funded without the fee output is therefore never claimable: its coins just go back to the sender at expiry. A sponsor could send an ordinary personal drop instead. That's free, but it carries no brand, isn't in any campaign and has no dashboard, so the things a sponsor pays for always come with the fee.

**Why this is defensible:**
- **Scales without a sales team:** sign-up, campaign, funding and reporting are all self-serve, and our marginal cost per drop is zero miner fees (§4.3).
- **Revenue can't be routed around:** the fee is paid on-chain in the same transaction that funds the envelope, before anyone can claim. There's no invoice to chase.
- **Honest limit:** the code is open source, so someone could run their own copy with their own gate and treasury. What they can't copy is the brand, the network of envelopes being passed on, and wallet integrations (§4.6).

### 4.5 Market evidence (sources to check before use)

Each figure has its source and the exact words, so you can verify it yourself. Use the figures, not our paraphrase.

**1. Digital red envelopes are a mass habit at Lunar New Year (WeChat, 2017).**
China Daily, Shi Jing, 10 Feb 2017, citing statistics from Tencent: "46 billion red packets were sent and received during the six days from lunar New Year's Eve".
Source: https://www.chinadaily.com.cn/a/201702/10/WS5a29190ea310fcb6fafd38cd.html
Caveat: this is 2017 data. Tencent didn't disclose the money inside the packets, and I found no comparable official figure after 2019.

**2. Hundreds of millions of people take part (WeChat, 2019).**
China Daily, Jiang Wei and Wang Yifan, 11 Feb 2019: "823 million people received and sent WeChat red packets" over the Spring Festival period.
Source: https://govt.chinadaily.com.cn/s/201902/11/WS5c627409498e27e338038289/post-1990-generation-dominates-wechat-red-packets.html

**3. Airdrops leak to farmers (academic study of nine major airdrops).**
Messias, Yaish, Livshits, "Airdrops: Giving Money Away Is Harder Than It Seems" (arXiv 2312.02752): "up to 66% in some cases" of tokens "are rapidly sold", a behaviour the authors say is "largely driven by 'airdrop farmers'".
Source: https://arxiv.org/abs/2312.02752

**4. A concrete example: Celestia's airdrop (researcher estimate, secondary report).**
ForkLog, 2 Nov 2023, reporting research by the X-explore team: "Approximately 40% of the TIA tokens distributed in Celestia's airdrop were claimed by hunters".
Source: https://forklog.com/en/news/experts-40-of-celestia-tokens-went-to-airdrop-hunters
Caveat: an analytics team's estimate posted on X, reported by a crypto news site, not peer-reviewed. Use "an estimated 40%" if at all.

**Not used:** crypto user-acquisition cost per user. The figures I found (e.g. "~$150 per exchange user") come from ad-tech vendors' blogs that sell the measurement, with no primary data behind them. Leave them out unless you find an independent source.

**How we use it in the pitch:** red envelopes are already how hundreds of millions of people gift money at Lunar New Year (1, 2), and the usual way crypto projects give money away leaks a large share to farmers (3, 4). Hongbao brings the first to Bitcoin Cash and answers the second by measuring fresh → activated → not-farmed wallets so a sponsor sees what it paid per real new wallet.

## Words to use

- "lockbox", "leftovers return automatically", "Hongbao Seal". Avoid "UTXO", "covenant", "P2SH" on slides.
- Our NFTs are always **Hongbao Seals**.
- Mention CashStamps by name only, positively, with no comparison table and no logo.
