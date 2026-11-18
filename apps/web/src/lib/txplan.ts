// Pure transaction planning for wallet-funded txs (no React, no WizardConnect), so it can be tested
// and reused by a Chipnet harness. The wallet layer (wallet.tsx) has the wallet sign what this builds.
import { TransactionBuilder, placeholderP2PKHUnlocker, type NetworkProvider, type Output, type Unlocker, type Utxo } from 'cashscript';

export interface PlanAddr {
  lockingBytecode: Uint8Array;
  lockingHex: string;
  address: string;
}
export type PlanUtxo = Utxo & { addr: PlanAddr };

/** P2PKH dust: change below this is dropped into the fee. */
export const DUST = 546n;
/** Size of a P2PKH change output (8 value + 1 length + 25 script). */
const CHANGE_OUTPUT_BYTES = 34n;

export class InsufficientFunds extends Error {
  constructor(
    public needSats: bigint,
    public haveSats: bigint,
  ) {
    super(`Your wallet needs about ${needSats - haveSats} more sats for this.`);
  }
}

/** A rough fee for planning (1 sat/B): ~148 B per P2PKH input, ~60 B per output, plus overhead. */
export const estimateFee = (inputs: number, outputs: number, extraBytes = 0) => BigInt(148 * inputs + 60 * outputs + 20 + extraBytes);

/** A TransactionBuilder with the inputs, `outputs`, then change (if any) last. */
export function txBuilder(
  provider: NetworkProvider,
  inputs: PlanUtxo[],
  outputs: Output[],
  change: PlanAddr,
  changeSats: bigint | null,
  unlocker: (u: PlanUtxo) => Unlocker = (u) => placeholderP2PKHUnlocker(u.addr.address),
): TransactionBuilder {
  const tb = new TransactionBuilder({ provider });
  for (const u of inputs) tb.addInput({ ...u, lockingBytecode: u.lockingBytecode ?? u.addr.lockingHex }, unlocker(u));
  tb.addOutputs(outputs);
  if (changeSats !== null) tb.addOutput({ to: change.lockingBytecode, amount: changeSats });
  return tb;
}

/**
 * Change for a 1 sat/B tx, or null when it would be dust (then it goes to the fee).
 * The size is measured WITH a change output (amounts are always 8 bytes, so any placeholder value
 * works), including the signature bytes placeholder unlockers will get. A tx that ends up with
 * change therefore never pays for fewer bytes than it has; without change the fee is 34 sats higher
 * than needed, which is harmless.
 */
export function planChange(provider: NetworkProvider, inputs: PlanUtxo[], outputs: Output[], change: PlanAddr): bigint | null {
  const inSum = inputs.reduce((s, u) => s + u.satoshis, 0n);
  const outSum = outputs.reduce((s, o) => s + o.amount, 0n);
  if (inSum - outSum < estimateFee(inputs.length, outputs.length)) throw new InsufficientFunds(outSum + estimateFee(inputs.length, outputs.length + 1), inSum);
  const size = txBuilder(provider, inputs, outputs, change, DUST).getTransactionSize();
  const changeSats = inSum - outSum - size;
  if (changeSats >= DUST) return changeSats;
  if (inSum - outSum < size - CHANGE_OUTPUT_BYTES) throw new InsufficientFunds(outSum + size - CHANGE_OUTPUT_BYTES, inSum);
  return null;
}
