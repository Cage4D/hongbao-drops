// Build a refundBatch tx (spec §6.4). Keyless: anyone may broadcast it, but the contract only
// lets the outputs go to the sender's refund script, and only once tx locktime ≥ expiry.
import { TransactionBuilder, type Utxo } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import type { HongbaoContract } from './hongbao.js';
import { MAX_REFUND_BATCH } from './hongbao.js';

export interface RefundTxInput {
  contract: HongbaoContract;
  /** Contract UTXOs to refund (≤ MAX_REFUND_BATCH). Each keeps its own token on its own output. */
  utxos: (Utxo & { lockingBytecode?: string })[];
  refundLockingBytecode: string; // hex, must equal the contract's constructor arg
  expiry: number; // used as nLockTime
  maxFee: bigint;
  feeRate?: number; // sat/byte, default 1
}

export function buildRefundTx(i: RefundTxInput): { hex: string; feePerInput: bigint; refundedSats: bigint } {
  if (i.utxos.length === 0) throw new Error('nothing to refund');
  if (i.utxos.length > MAX_REFUND_BATCH) throw new Error(`at most ${MAX_REFUND_BATCH} shares per refund tx`);
  const to = hexToBin(i.refundLockingBytecode);
  const build = (feeEach: bigint) => {
    const tb = new TransactionBuilder({ provider: i.contract.provider });
    for (const u of i.utxos) tb.addInput({ ...u, lockingBytecode: i.contract.lockingBytecode }, i.contract.unlock.refundBatch());
    for (const u of i.utxos) tb.addOutput({ to, amount: u.satoshis - feeEach, ...(u.token && { token: u.token }) });
    return tb.setLocktime(i.expiry).build();
  };
  const n = BigInt(i.utxos.length);
  const size = BigInt(build(500n).length / 2);
  const feePerInput = (size * BigInt(i.feeRate ?? 1) + n - 1n) / n; // ceil
  if (feePerInput > i.maxFee) throw new Error(`fee per input ${feePerInput} exceeds maxFee ${i.maxFee}`);
  const hex = build(feePerInput);
  return { hex, feePerInput, refundedSats: i.utxos.reduce((s, u) => s + u.satoshis - feePerInput, 0n) };
}
