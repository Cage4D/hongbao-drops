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

/**
 * Split contract UTXOs into ones worth refunding and dust: a coin whose value minus the worst-case
 * fee would be below the dust limit can't be refunded (the whole tx would be invalid). Anyone can
 * send such a coin to a contract, so the keeper must leave it behind instead of failing (review #1).
 */
export function refundableUtxos<U extends Utxo>(utxos: U[], refundLockingBytecode: string, maxFee: bigint) {
  const refundable: U[] = [];
  const dust: U[] = [];
  for (const u of utxos) {
    const min = dustLimit(refundLockingBytecode.length / 2, u.token) + maxFee;
    (u.satoshis >= min ? refundable : dust).push(u);
  }
  return { refundable, dust };
}

export function buildRefundTx(i: RefundTxInput): { hex: string; feePerInput: bigint; refundedSats: bigint } {
  if (i.utxos.length === 0) throw new Error('nothing to refund');
  if (i.utxos.length > MAX_REFUND_BATCH) throw new Error(`at most ${MAX_REFUND_BATCH} shares per refund tx`);
  const to = hexToBin(i.refundLockingBytecode);
  const build = (amountOf: (u: Utxo) => bigint) => {
    const tb = new TransactionBuilder({ provider: i.contract.provider });
    for (const u of i.utxos) tb.addInput({ ...u, lockingBytecode: i.contract.lockingBytecode }, i.contract.unlock.refundBatch());
    for (const u of i.utxos) tb.addOutput({ to, amount: amountOf(u), ...(u.token && { token: u.token }) });
    return tb.setLocktime(i.expiry).build();
  };
  const n = BigInt(i.utxos.length);
  for (const u of i.utxos) {
    if (u.satoshis <= dustLimit(to.length, u.token)) throw new Error(`UTXO ${u.txid}:${u.vout} is too small to refund`);
  }
  // Measure with every output at its dust limit: amounts don't change the size (review #1).
  const size = BigInt(build((u) => dustLimit(to.length, u.token)).length / 2);
  const feePerInput = (size * BigInt(i.feeRate ?? 1) + n - 1n) / n; // ceil
  if (feePerInput > i.maxFee) throw new Error(`fee per input ${feePerInput} exceeds maxFee ${i.maxFee}`);
  for (const u of i.utxos) {
    if (u.satoshis - feePerInput < dustLimit(to.length, u.token)) throw new Error(`UTXO ${u.txid}:${u.vout} is too small to refund`);
  }
  const hex = build((u) => u.satoshis - feePerInput);
  return { hex, feePerInput, refundedSats: i.utxos.reduce((s, u) => s + u.satoshis - feePerInput, 0n) };
}
