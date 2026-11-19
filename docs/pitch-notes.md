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

## Words to use

- "lockbox", "leftovers return automatically", "Hongbao Seal". Avoid "UTXO", "covenant", "P2SH" on slides.
- Our NFTs are always **Hongbao Seals**.
- Mention CashStamps by name only, positively, with no comparison table and no logo.
