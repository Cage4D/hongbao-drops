<!--
  Before submission (22 Nov 14:00 UTC), replace every ⟨TODO …⟩ with real values:
  the frontend URL, the BLAZE Drop numbers from /campaigns/:id/public, and the Nov 19 mainnet txids.
  Never put test-network numbers where real ones belong.
-->

# Hongbao Drops 🧧

**Drop a red envelope of Bitcoin Cash into any group chat as one link. The first people to open it each get a share of real BCH and a collectible stamp, in seconds, with no fees and nothing to sign.**

### 👉 [Try it](https://hongbao-drops.vercel.app) · built for BCH BLAZE 2026 (Mainnet Track)

<p>
  <img src="docs/media/og-lunar.png" alt="A Lunar New Year red envelope link preview: Happy New Year!, 3 of 3 shares left" width="420">
  <img src="docs/media/stamp-gold.png" alt="A gold collectible Hongbao stamp" width="160">
</p>

---

## Try it in 30 seconds

1. **Open the [demo envelope](⟨TODO: demo envelope link⟩)** on your phone.
2. **Tap to open it.** Connect your Bitcoin Cash wallet, or paste your BCH address. No wallet yet? Try [Paytaca](https://www.paytaca.com) and tap **"Hold my share"**: we keep a share for you for 15 minutes while you install it.
3. **Watch it arrive.** Your share of BCH lands in your wallet within seconds, together with a **collectible stamp** showing you caught it.
4. **Pass it on** (optional). Re-gift part of what you got as a new envelope, and see how far your drop travels.

You need no BCH to start and pay no fees. You don't sign anything to receive.

## What just happened

- The sender put BCH into a **lockbox** on the Bitcoin Cash blockchain, split into shares, one per person.
- The link you opened carries the key to that lockbox. We approve each claim so that everyone gets one share each.
- Your share went **straight from the lockbox to your wallet**. Hongbao never held your money.
- Every share comes with its own **collectible stamp**, made at the moment the envelope was created.
- When the envelope expires, **leftovers return automatically** to the sender. Nobody, not even the sender, can take the money back before then.

## Why sponsors pay

Brands and BCH projects want new people using BCH, but airdrops get farmed and ad clicks can't be verified. A **Sponsored Drop** is a branded envelope (logo, colour, a link to the sponsor, optionally a quiz question) for a **3% fee**. In return the sponsor gets a live dashboard:

- how many people claimed;
- how many of them were **brand-new wallets**;
- how many of those **actually used** their BCH or passed it on within 7 days;
- how many looked like **farming** (flagged, never blocked);
- and the headline number, **cost per real new wallet**.

Every number links to a public blockchain transaction, so anyone can check it. No ad network can offer that.

**Our own "BLAZE Drop" campaign, live on mainnet:**

| | |
|---|---|
| People who claimed | ⟨TODO⟩ |
| Brand-new wallets | ⟨TODO⟩ |
| Of those, used their BCH or passed it on | ⟨TODO⟩ |
| Envelopes passed on | ⟨TODO⟩ |
| **Cost per real new wallet** | ⟨TODO⟩ |
| Public proof (every transaction) | ⟨TODO: /campaigns/:id/public link⟩ |

Free for personal envelopes. Sponsors pay the 3% fee, collected automatically when the envelope is created. An envelope can't skip the fee: without it nobody can claim from it, and the money simply goes back after expiry.

## Why it's safe

- **We can't take your money.** Opening the lockbox needs the key from the link, and Hongbao never sees that key.
- **Someone with the link can't empty it alone.** Each share needs our approval, which pays one specific share to one specific person.
- **The sender can't take it back early.** Once the envelope is sent, it stays open until it expires.
- **Leftovers can only go back to the sender**, nowhere else.
- **If Hongbao went offline**, claims would pause, but every unclaimed share would still return to its sender.

What it can't do: someone with many wallets can claim more than once. That's why sponsors see "brand-new wallets" and "used it" separately, and why suspected farming is flagged in their dashboard.

## See it on the blockchain (mainnet)

| What | Transaction |
|---|---|
| An envelope being sent: shares in the lockbox, each with a collectible stamp | ⟨TODO: Nov 19 funding txid⟩ |
| Someone claiming a share: BCH + stamp to their wallet | ⟨TODO: Nov 19 claim txid⟩ |
| Leftovers returning automatically, many shares in one go | ⟨TODO: Nov 19 refund txid⟩ |

Rehearsals on the BCH test network (Chipnet): [envelope sent](https://chipnet.imaginary.cash/tx/e29f87de8794f42e97453477d637dd1afae2b75e6eacac496c08b95b194adc53) · [share claimed](https://chipnet.imaginary.cash/tx/41641d911704c5557e53b763b5b13f9115e02272db94a621cef2966975ded4f9) · [leftovers returned](https://chipnet.imaginary.cash/tx/744ff9d40cf9d0e4dd257f6c9852f3f6ee7da5e0a48b7b0d5c0c5bb308fc74f8).

---

## Technical detail

**Contract.** One CashScript 0.14 contract per envelope, deployed as P2SH32 ([walkthrough](packages/contract/contracts/README.md)). Each share is its own UTXO, so claims never race each other.
- **`claim`** requires the link key's signature *and* a gate datasig over `recipient ‖ outpoint`. One input, one output, a fee bounded by `maxFee`, and the stamp NFT must pass through unchanged.
- **`refundBatch`** is keyless and only valid after expiry (CLTV; nodes also wait for median-time-past). It pays only to the sender's script, and uses the 2026 **Layla loop opcodes** to refund many shares in one transaction.

**Stamps.** The funding transaction is a CashTokens genesis: every share carries an immutable NFT (commitment = envelope ‖ share). A BCMR OP_RETURN points wallets to the metadata (`/bcmr/:category.json`), served byte-for-byte as hashed on-chain. Output 0 is an identity output to the treasury, so the BCMR authchain never moves.

**Gate and API.** NestJS + Prisma + Postgres on Vercel, Neon database.
- **Gate:** the per-envelope gate key is derived from a master seed. The gate checks eligibility (one share per address, wallet fingerprint and hold token; rate limits; quiz answers hashed) and signs only after the funding was verified on-chain, sponsor fee included.
- **Claims:** "fresh wallet" comes from Fulcrum address history; claims are accepted at 0-conf.
- **Keeper** (keyless, every minute via an external cron): batch refunds once median-time-past passes expiry, reconciliation of spends made outside the API, confirmations, 7-day activation and farm flags (`SAME_FINGERPRINT`, `SAME_IP`, `IP_BURST`, `COMMON_SWEEP`, `NEVER_USED`).
- **Also:** live updates over SSE, OG link-preview cards and stamp art rendered server-side, and mainnet budget caps enforced server-side.

**Trust model.** The server can't move funds without the link key. A link holder can't drain an envelope without per-claim gate signatures. Refunds go only to the refund script fixed in the contract. If the gate is down, liveness suffers, never custody.

**Quality.** 193 automated tests (contract VM matrix, API on real Postgres with a mock chain), Chipnet end-to-end suites run against the production URL, and two external code reviews with every finding fixed ([review 1](docs/review-1-fixes.md), [review 2](docs/review-2-fixes.md)). Decisions and research: [docs/findings.md](docs/findings.md).

**For developers:** setup, layout, testing and deployment are in [CONTRIBUTING.md](CONTRIBUTING.md).
