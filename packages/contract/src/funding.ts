// Funding-tx layout, shared by the Chipnet scripts, the API's on-chain verifier (Phase 3) and the
// frontend. Building the output list in one place keeps the three in agreement.
//
// Output order:
//   [0]      identity output → treasury    (seals only: keeps the BCMR authchain alive, findings §5)
//   [1..N]   shares → contract              (each with one immutable seal NFT when seals are on)
//   [next]   sponsor fee → treasury          (sponsored drops only)
//   [next]   BCMR OP_RETURN                  (seals only)
//   [last]   change → sender                 (added by the caller)
//
// CashTokens genesis rule: the seal category = txid of the outpoint spent by input 0, and that
// outpoint MUST be at output index 0. The caller ensures this (or makes a "prep" tx first).
import type { Output } from 'cashscript';
import { binToHex, encodeDataPush, sha256 } from '@bitauth/libauth';
import type { HongbaoContract } from './hongbao.js';
import { MIN_SHARE_SATS_NO_SEAL, MIN_SHARE_SATS_WITH_SEAL, sealCommitment } from './hongbao.js';

/** Plain P2PKH dust; the identity output only needs to exist, not carry value. */
export const IDENTITY_OUTPUT_SATS = 546n;

export interface FundingPlan {
  contract: HongbaoContract;
  /** One entry per share, in share order (share i ↔ shareIndex i+1). */
  shareAmounts: bigint[];
  /** Present when the envelope mints seals. */
  seals?: {
    /** Display-hex txid of the vout-0 outpoint that input 0 spends (= the new token category). */
    category: string;
    /** Envelope sequence number (also the gate key index). */
    envelopeSeq: number;
    /** Where the identity output goes (the treasury). */
    identityLockingBytecode: Uint8Array;
    /** BCMR publication: sha256 of the exact registry bytes + URIs (no protocol = https). */
    bcmr: { registryHash: Uint8Array; uris: string[] };
  };
  /** Sponsored drops: treasury fee output (feeBps of the funded amount). */
  sponsorFee?: { lockingBytecode: Uint8Array; amount: bigint };
}

/** sha256 of the registry bytes, in VM byte order (as the BCMR OP_RETURN wants it). */
export function bcmrRegistryHash(registryBytes: Uint8Array): Uint8Array {
  return sha256.hash(registryBytes);
}

/** OP_RETURN <'BCMR'> <sha256(registry)> <uri>… */
export function bcmrOpReturn(registryHash: Uint8Array, uris: string[]): Uint8Array {
  if (registryHash.length !== 32) throw new Error('BCMR hash must be 32 bytes');
  if (uris.length === 0) throw new Error('at least one BCMR URI is required');
  const enc = new TextEncoder();
  const pushes = [enc.encode('BCMR'), registryHash, ...uris.map((u) => enc.encode(u))].map(encodeDataPush);
  return Uint8Array.from([0x6a, ...pushes.flatMap((p) => [...p])]);
}

/** The outputs of a funding tx, excluding change. Throws on any plan the API would reject. */
export function fundingOutputs(plan: FundingPlan): Output[] {
  const { contract, shareAmounts, seals, sponsorFee } = plan;
  if (shareAmounts.length < 1 || shareAmounts.length > 127) throw new Error('shareCount must be 1..127');
  const minShare = seals ? MIN_SHARE_SATS_WITH_SEAL : MIN_SHARE_SATS_NO_SEAL;
  shareAmounts.forEach((a, i) => {
    if (a < minShare) throw new Error(`share ${i + 1} is ${a} sats, below the ${minShare}-sat minimum`);
  });
  if (seals && !/^[0-9a-f]{64}$/.test(seals.category)) {
    throw new Error('seals.category must be a lowercase 64-hex txid');
  }

  const outputs: Output[] = [];
  if (seals) outputs.push({ to: seals.identityLockingBytecode, amount: IDENTITY_OUTPUT_SATS });

  shareAmounts.forEach((amount, i) => {
    outputs.push({
      to: contract.tokenAddress,
      amount,
      ...(seals && {
        token: {
          category: seals.category,
          amount: 0n,
          nft: { capability: 'none' as const, commitment: binToHex(sealCommitment(seals.envelopeSeq, i + 1)) },
        },
      }),
    });
  });

  if (sponsorFee) outputs.push({ to: sponsorFee.lockingBytecode, amount: sponsorFee.amount });
  if (seals) outputs.push({ to: bcmrOpReturn(seals.bcmr.registryHash, seals.bcmr.uris), amount: 0n });
  return outputs;
}

/** Index of share i (0-based) inside the funding tx: shifted by one when an identity output leads. */
export function shareOutputIndex(shareIdx0: number, withSeals: boolean): number {
  return shareIdx0 + (withSeals ? 1 : 0);
}

/**
 * Lucky mode: random split of `total` into `count` shares, each >= `min`.
 * Uses crypto randomness; the sender's browser runs this, so the server can't bias the split.
 */
export function luckySplit(total: bigint, count: number, min: bigint): bigint[] {
  if (count < 1) throw new Error('count must be >= 1');
  const spare = total - min * BigInt(count);
  if (spare < 0n) throw new Error('total too small for count × min');
  const weights = Array.from(crypto.getRandomValues(new Uint32Array(count)), (w) => BigInt(w) + 1n);
  const sum = weights.reduce((a, b) => a + b, 0n);
  const shares = weights.map((w) => min + (spare * w) / sum);
  // Hand the rounding remainder to share 0 so the split sums exactly to `total`.
  shares[0]! += total - shares.reduce((a, b) => a + b, 0n);
  return shares;
}

/** Equal split; any remainder goes to the first shares, one sat each. */
export function equalSplit(total: bigint, count: number): bigint[] {
  const base = total / BigInt(count);
  const rem = Number(total % BigInt(count));
  return Array.from({ length: count }, (_, i) => base + (i < rem ? 1n : 0n));
}
