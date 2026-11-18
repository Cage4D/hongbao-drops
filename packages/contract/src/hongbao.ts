// @hongbao/contract — the Hongbao CashScript contract plus the byte-exact helpers the API (gate),
// the keeper and the frontend share. Keeping these in one place means the message the gate signs
// can never drift from what the contract verifies.
import { Contract, type NetworkProvider } from 'cashscript';
import { hexToBin, secp256k1, sha256 } from '@bitauth/libauth';
import artifact from './artifacts/Hongbao.js';

export const hongbaoArtifact = artifact;
export const CASHSCRIPT_VERSION = '0.14.0';

/** Default per-input fee cap. Claim ≈ 590 B (≈ 625 split), refund ≈ 450 B per share → ~1.6 sat/B headroom. */
export const DEFAULT_MAX_FEE = 1_000n;
/** Smallest share the API accepts (docs/findings.md §3): keeps claim/refund outputs above dust. */
export const MIN_SHARE_SATS_WITH_SEAL = 2_000n;
export const MIN_SHARE_SATS_NO_SEAL = 1_500n;
/** Keeper batch cap: refundBatch re-checks every pair from every input (O(n²)). */
export const MAX_REFUND_BATCH = 20;
/** nLockTime values below this are block heights, not timestamps. */
export const LOCKTIME_THRESHOLD = 500_000_000;

export interface HongbaoParams {
  linkPk: Uint8Array;
  gatePk: Uint8Array;
  refundLockingBytecode: Uint8Array;
  /** Unix seconds; must be a timestamp locktime (>= 500,000,000). */
  expiry: bigint | number;
  maxFee?: bigint;
}

export type HongbaoConstructorArgs = [Uint8Array, Uint8Array, Uint8Array, bigint, bigint];

/** Validates and orders constructor args exactly as Hongbao.cash declares them. */
export function hongbaoConstructorArgs(p: HongbaoParams): HongbaoConstructorArgs {
  if (p.linkPk.length !== 33) throw new Error('linkPk must be a 33-byte compressed public key');
  if (p.gatePk.length !== 33) throw new Error('gatePk must be a 33-byte compressed public key');
  if (p.refundLockingBytecode.length === 0) throw new Error('refundLockingBytecode is empty');
  const expiry = BigInt(p.expiry);
  if (expiry < BigInt(LOCKTIME_THRESHOLD) || expiry > 0xffffffffn) {
    throw new Error('expiry must be a unix timestamp between 500,000,000 and 2^32-1');
  }
  const maxFee = p.maxFee ?? DEFAULT_MAX_FEE;
  if (maxFee < 0n) throw new Error('maxFee must be >= 0');
  return [p.linkPk, p.gatePk, p.refundLockingBytecode, expiry, maxFee];
}

/** One Contract instance per envelope, deployed as P2SH32 (P2S doesn't fit, see findings §1). */
export type HongbaoContract = Contract<typeof artifact>;

export function hongbaoContract(p: HongbaoParams, provider: NetworkProvider): HongbaoContract {
  return new Contract(artifact, hongbaoConstructorArgs(p), { provider, contractType: 'p2sh32' });
}

/**
 * The exact bytes the gate signs, and the contract re-creates in `claim`:
 *   recipientLockingBytecode ‖ outpointTxHash (internal byte order) ‖ u32le(outpointIndex)
 *
 * @param outpointTxid txid as shown by explorers/Electrum (big-endian display hex).
 *   It is reversed here because OP_OUTPOINTTXHASH yields the internal byte order.
 */
export function gateMessage(
  recipientLockingBytecode: Uint8Array,
  outpointTxid: string,
  outpointIndex: number,
): Uint8Array {
  if (recipientLockingBytecode.length === 0) throw new Error('recipient locking bytecode is empty');
  if (!/^[0-9a-fA-F]{64}$/.test(outpointTxid)) throw new Error('outpointTxid must be 64 hex chars');
  // toPaddedBytes(x, 4) is OP_NUM2BIN on a script number: only identical to u32le below 2^31.
  if (!Number.isInteger(outpointIndex) || outpointIndex < 0 || outpointIndex > 0x7fffffff) {
    throw new Error('outpointIndex must be an integer in [0, 2^31)');
  }
  const txHashInternal = hexToBin(outpointTxid).reverse();
  const index = new Uint8Array(4);
  new DataView(index.buffer).setUint32(0, outpointIndex, true);
  return Uint8Array.from([...recipientLockingBytecode, ...txHashInternal, ...index]);
}

/** Gate approval: 64-byte Schnorr signature over sha256(message), as OP_CHECKDATASIG expects. */
export function signGateApproval(gatePrivateKey: Uint8Array, message: Uint8Array): Uint8Array {
  const sig = secp256k1.signMessageHashSchnorr(gatePrivateKey, sha256.hash(message));
  if (typeof sig === 'string') throw new Error(`gate signing failed: ${sig}`);
  return sig;
}

/**
 * Seal NFT commitment: u32le(envelopeSeq) ‖ u8(shareIndex), with shareIndex 1-based.
 * BCMR reads sequential-NFT commitments as VM numbers; the last byte is the most significant,
 * so it must be non-zero (minimal encoding) and < 0x80 (positive). See findings §5.
 */
export function sealCommitment(envelopeSeq: number, shareIndex: number): Uint8Array {
  if (!Number.isInteger(envelopeSeq) || envelopeSeq < 0 || envelopeSeq > 0xffffffff) {
    throw new Error('envelopeSeq must fit in 4 bytes');
  }
  if (!Number.isInteger(shareIndex) || shareIndex < 1 || shareIndex > 0x7f) {
    throw new Error('shareIndex must be 1..127');
  }
  const out = new Uint8Array(5);
  new DataView(out.buffer).setUint32(0, envelopeSeq, true);
  out[4] = shareIndex;
  return out;
}
