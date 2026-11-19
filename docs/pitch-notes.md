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

## Words to use

- "lockbox", "leftovers return automatically", "Hongbao Seal". Avoid "UTXO", "covenant", "P2SH" on slides.
- Our NFTs are always **Hongbao Seals**.
- Mention CashStamps by name only, positively, with no comparison table and no logo.
