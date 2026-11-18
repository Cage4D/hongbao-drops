// Build a refundBatch tx (spec §6.4). Keyless: anyone may broadcast it, but the contract only
// lets the outputs go to the sender's refund script, and only once tx locktime ≥ expiry.
import { TransactionBuilder, type Utxo } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import type { HongbaoContract } from './hongbao.js';
import { MAX_REFUND_BATCH } from './hongbao.js';
import { dustLimit } from './dust.js';

export interface RefundTxInput {
  contract: HongbaoContract;
  /** Contract UTXOs to refund (≤ MAX_REFUND_BATCH). Each keeps its own token on its own output. */
  utxos: (Utxo & { lockingBytecode?: string })[];
  refundLockingBytecode: string; // hex, must equal the contract's constructor arg
  expiry: number; // used as nLockTime
  maxFee: bigint;
  feeRate?: number; // sat/byte, default 1
}

export interface RefundPlan<U> {
  hex: string;
  feePerInput: bigint;
  refundedSats: bigint;
  /** Coins spent by this tx (≤ MAX_REFUND_BATCH). */
  batch: U[];
  /** Coins that can never be refunded: value minus the real per-input fee would be below dust. */
  dust: U[];
  /** Refundable coins left for a later tx (more than MAX_REFUND_BATCH were waiting). */
  remaining: U[];
}

/**
 * Choose what to refund from an expired contract's coins and build the tx (review #1, review-2 P1-1).
 *
 * Uses the fee buildRefundTx actually measures (~340 sat per input at 1 sat/B), not the worst-case
 * maxFee — judging by maxFee stranded every no-seal share under 1,546 sats, although the API
 * accepts shares from 1,500. Largest coins first; if the smallest coin in the batch can't cover its
 * share of the fee, it's dropped as dust and the batch is rebuilt. (A smaller batch only raises the
 * per-input fee, so a dropped coin could never be refunded on its own either.) Anyone can send dust
 * to a contract, so the keeper must leave it behind instead of failing. Returns null if nothing can
 * be refunded.
 */
export function planRefund<U extends Utxo>(i: Omit<RefundTxInput, 'utxos'> & { utxos: U[] }): RefundPlan<U> | null {
  const toLen = i.refundLockingBytecode.length / 2;
  const dust = i.utxos.filter((u) => u.satoshis <= dustLimit(toLen, u.token));
  const pool = i.utxos.filter((u) => u.satoshis > dustLimit(toLen, u.token)).sort((a, b) => Number(b.satoshis - a.satoshis));
  const batch = pool.slice(0, MAX_REFUND_BATCH);
  const remaining = pool.slice(MAX_REFUND_BATCH);
  while (batch.length > 0) {
    try {
      return { ...buildRefundTx({ ...i, utxos: batch }), batch, dust, remaining };
    } catch (e) {
      if (!/too small to refund/.test((e as Error).message)) throw e;
      dust.push(batch.pop()!);
    }
  }
  return null;
}

export function buildRefundTx(i: RefundTxInput): { hex: string; feePerInput: bigint; refundedSats: bigint } {
  if (i.utxos.length === 0) throw new Error('nothing to refund');
  if (i.utxos.length > MAX_REFUND_BATCH) throw new Error(`at most ${MAX_REFUND_BATCH} shares per refund tx`);
  const to = hexToBin(i.refundLockingBytecode);
  // `inflate` adds value to each input for the size-measuring build only. Input values aren't
  // serialised (refundBatch has no signature either), so the size is unchanged, but CashScript's own
  // "fee per byte below 1" check can no longer fire on a near-dust coin before our clearer
  // "too small to refund" error does (review-2 P1-1).
  const withTokens = i.utxos.some((u) => u.token);
  const plainDust = dustLimit(to.length);
  // With seals, each seal goes back on its own dust output and the rest of the value is pooled
  // into one extra plain-BCH output, which wallets count as balance (Paytaca, 2026-11-18).
  // Without seals, input i is refunded 1:1 by output i as before.
  const build = (amountOf: (u: Utxo) => bigint, bch: bigint | undefined, inflate = 0n) => {
    const tb = new TransactionBuilder({ provider: i.contract.provider });
    for (const u of i.utxos) {
      tb.addInput({ ...u, satoshis: u.satoshis + inflate, lockingBytecode: i.contract.lockingBytecode }, i.contract.unlock.refundBatch());
    }
    for (const u of i.utxos) tb.addOutput({ to, amount: amountOf(u), ...(u.token && { token: u.token }) });
    if (bch !== undefined) tb.addOutput({ to, amount: bch });
    return tb.setLocktime(i.expiry).build();
  };
  const n = BigInt(i.utxos.length);
  const dustOf = (u: Utxo) => dustLimit(to.length, u.token);
  for (const u of i.utxos) {
    if (u.satoshis <= dustOf(u)) throw new Error(`UTXO ${u.txid}:${u.vout} is too small to refund`);
  }
  const inSum = i.utxos.reduce((s, u) => s + u.satoshis, 0n);
  if (withTokens) {
    // Measure with every output at its dust limit: amounts don't change the size (review #1).
    const size = BigInt(build(dustOf, plainDust, 100_000n).length / 2);
    const fee = size * BigInt(i.feeRate ?? 1);
    const feePerInput = (fee + n - 1n) / n; // ceil, for reporting and the maxFee check
    const bch = inSum - fee - i.utxos.reduce((s, u) => s + dustOf(u), 0n);
    if (feePerInput <= i.maxFee && bch >= plainDust) {
      return { hex: build(dustOf, bch), feePerInput, refundedSats: inSum - fee };
    }
    // Too small to pool: fall through to 1:1 outputs.
  }
  const size = BigInt(build(dustOf, undefined, 100_000n).length / 2);
  const feePerInput = (size * BigInt(i.feeRate ?? 1) + n - 1n) / n; // ceil
  if (feePerInput > i.maxFee) throw new Error(`fee per input ${feePerInput} exceeds maxFee ${i.maxFee}`);
  for (const u of i.utxos) {
    if (u.satoshis - feePerInput < dustOf(u)) throw new Error(`UTXO ${u.txid}:${u.vout} is too small to refund`);
  }
  const hex = build((u) => u.satoshis - feePerInput, undefined);
  return { hex, feePerInput, refundedSats: i.utxos.reduce((s, u) => s + u.satoshis - feePerInput, 0n) };
}
