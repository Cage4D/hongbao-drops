// On-chain verification of a funding tx (spec §6.1 step 5). Pure: easy to unit-test.
// An envelope only becomes ACTIVE when EVERY expected output is exactly right; the gate never
// approves claims on unverified envelopes, which is how the sponsor fee is enforced in practice.
import { binToHex, type TransactionCommon } from '@bitauth/libauth';
import {
  IDENTITY_OUTPUT_SATS,
  MIN_SHARE_SATS_NO_STAMP,
  MIN_SHARE_SATS_WITH_STAMP,
  bcmrOpReturn,
  equalSplit,
  shareOutputIndex,
  stampCommitment,
} from '@hongbao/contract';
import { hexToBin } from '@bitauth/libauth';

export interface ExpectedFunding {
  seq: number;
  mode: 'EQUAL' | 'LUCKY' | 'QUIZ';
  shareCount: number;
  totalSats: bigint;
  withStamps: boolean;
  stampCategory: string | null;
  bcmrHash: string | null;
  bcmrUri: string | null;
  sponsorFeeSats: bigint;
  contractLockingBytecode: string; // hex
  treasuryLockingBytecode: string; // hex
}

export interface VerifiedShare {
  index: number;
  vout: number;
  sats: bigint;
  nftCommitment: string | null;
}

export type VerifyResult = { ok: true; shares: VerifiedShare[] } | { ok: false; reasons: string[] };

export function verifyFundingTx(tx: TransactionCommon, e: ExpectedFunding): VerifyResult {
  const reasons: string[] = [];
  const out = tx.outputs;
  const lb = (i: number) => (out[i] ? binToHex(out[i].lockingBytecode) : undefined);
  const minShare = e.withStamps ? MIN_SHARE_SATS_WITH_STAMP : MIN_SHARE_SATS_NO_STAMP;

  // 1. Genesis: input 0 must spend <stampCategory>:0 (CashTokens rule; the node enforces it too).
  if (e.withStamps) {
    const in0 = tx.inputs[0];
    // libauth decodes outpointTransactionHash in UI (display) byte order, same as our txid strings.
    const in0Txid = in0 ? binToHex(in0.outpointTransactionHash) : '';
    if (!in0 || in0Txid !== e.stampCategory || in0.outpointIndex !== 0) {
      reasons.push(`input 0 must spend ${e.stampCategory}:0 (stamp genesis)`);
    }
    // 2. Identity output keeps the BCMR authchain alive (findings §5).
    const id = out[0];
    if (!id || lb(0) !== e.treasuryLockingBytecode || id.valueSatoshis < IDENTITY_OUTPUT_SATS || id.token) {
      reasons.push(`output 0 must be the ${IDENTITY_OUTPUT_SATS}-sat identity output to the treasury`);
    }
  }

  // 3. Shares at their exact positions.
  const shares: VerifiedShare[] = [];
  let sum = 0n;
  for (let i = 0; i < e.shareCount; i++) {
    const vout = shareOutputIndex(i, e.withStamps);
    const o = out[vout];
    if (!o) {
      reasons.push(`share ${i + 1}: missing output ${vout}`);
      continue;
    }
    if (lb(vout) !== e.contractLockingBytecode) reasons.push(`share ${i + 1}: output ${vout} doesn't pay the envelope contract`);
    if (o.valueSatoshis < minShare) reasons.push(`share ${i + 1}: ${o.valueSatoshis} sats is below the ${minShare}-sat minimum`);
    let commitment: string | null = null;
    if (e.withStamps) {
      const want = binToHex(stampCommitment(e.seq, i + 1));
      const t = o.token;
      if (!t) reasons.push(`share ${i + 1}: missing stamp NFT`);
      else {
        if (binToHex(t.category) !== e.stampCategory) reasons.push(`share ${i + 1}: stamp has the wrong category`);
        if (t.amount !== 0n) reasons.push(`share ${i + 1}: stamp must not carry fungible tokens`);
        if (!t.nft || t.nft.capability !== 'none') reasons.push(`share ${i + 1}: stamp must be an immutable NFT`);
        commitment = t.nft ? binToHex(t.nft.commitment) : null;
        if (commitment !== want) reasons.push(`share ${i + 1}: stamp commitment ${commitment} ≠ ${want}`);
      }
    } else if (o.token) {
      reasons.push(`share ${i + 1}: unexpected token on a stamp-less envelope`);
    }
    sum += o.valueSatoshis;
    shares.push({ index: i + 1, vout, sats: o.valueSatoshis, nftCommitment: commitment });
  }
  if (sum !== e.totalSats) reasons.push(`shares sum to ${sum} sats, envelope total is ${e.totalSats}`);
  // EQUAL means equal: exactly equalSplit (remainder sats on the first shares), review #12.
  if (e.mode === 'EQUAL') {
    const want = equalSplit(e.totalSats, e.shareCount);
    if (shares.some((sh, i) => sh.sats !== want[i])) reasons.push(`EQUAL envelope must split as ${want.join(', ')} sats`);
  }

  // 4. Sponsor fee right after the shares.
  let next = shareOutputIndex(e.shareCount, e.withStamps);
  if (e.sponsorFeeSats > 0n) {
    const f = out[next];
    if (!f || lb(next) !== e.treasuryLockingBytecode || f.valueSatoshis < e.sponsorFeeSats || f.token) {
      reasons.push(`output ${next} must pay the ${e.sponsorFeeSats}-sat sponsor fee to the treasury`);
    }
    next++;
  }

  // 5. BCMR publication, byte-exact.
  if (e.withStamps) {
    const want = binToHex(bcmrOpReturn(hexToBin(e.bcmrHash ?? ''), [e.bcmrUri ?? '']));
    if (lb(next) !== want) reasons.push(`output ${next} must be the BCMR OP_RETURN for this envelope`);
  }

  // 6. No stray outputs to the contract (every share must be known to the gate and keeper), and
  // no other output may carry the stamp category — e.g. a minting NFT kept on the sender's change
  // would let them forge "I caught it" stamps later (review #9).
  const known = new Set(shares.map((s) => s.vout));
  out.forEach((o, i) => {
    if (known.has(i)) return;
    if (binToHex(o.lockingBytecode) === e.contractLockingBytecode) reasons.push(`output ${i} pays the contract but isn't a declared share`);
    if (e.withStamps && o.token && binToHex(o.token.category) === e.stampCategory) {
      reasons.push(`output ${i} carries a token of the stamp category; only the shares may`);
    }
  });

  return reasons.length ? { ok: false, reasons } : { ok: true, shares };
}
