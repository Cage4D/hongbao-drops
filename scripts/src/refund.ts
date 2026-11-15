// Batch-refund an envelope's unclaimed shares on Chipnet after expiry (spec §6.4, keyless).
// Usage: pnpm --filter @hongbao/scripts refund -- --name demo1
import { parseArgs } from 'node:util';
import { hexToBin } from '@bitauth/libauth';
import { TransactionBuilder } from 'cashscript';
import { MAX_REFUND_BATCH } from '@hongbao/contract';
import { EXPLORER_TX } from './lib/env.js';
import { chipnetProvider, medianTimePast } from './lib/chain.js';
import { FEE_RATE, envelopeContract, txSize } from './lib/envelope.js';
import { loadEnvelope, saveEnvelope } from './lib/state.js';

const { values: a } = parseArgs({ options: { name: { type: 'string' } } });
const env = loadEnvelope(a.name!);
const provider = await chipnetProvider();
const contract = envelopeContract(env, provider);

// Nodes accept a timestamp locktime only once median-time-past (of the last 11 blocks) > locktime.
// MTP trails wall-clock by ~1 hour, so refunds open roughly an hour after expiry.
const mtp = await medianTimePast(provider);
if (mtp <= env.expiry) {
  const mins = Math.ceil((env.expiry - mtp) / 60);
  console.log(`Not refundable yet: median-time-past is ${mins} min before expiry. Try again later.`);
  process.exit(2);
}

const utxos = (await contract.getUtxos()).slice(0, MAX_REFUND_BATCH);
if (utxos.length === 0) {
  console.log('Nothing to refund.');
  process.exit(0);
}
const refundTo = hexToBin(env.refundLockingBytecodeHex);
const build = (feeEach: bigint) => {
  const tb = new TransactionBuilder({ provider });
  for (const u of utxos) tb.addInput(u, contract.unlock.refundBatch());
  for (const u of utxos) tb.addOutput({ to: refundTo, amount: u.satoshis - feeEach, ...(u.token && { token: u.token }) });
  return tb.setLocktime(env.expiry);
};
const size = BigInt(txSize(build(1_000n)));
const feeEach = (size * FEE_RATE + BigInt(utxos.length) - 1n) / BigInt(utxos.length);
const sent = await build(feeEach).send();

for (const s of env.shares) {
  if (utxos.some((u) => u.txid === s.txid && u.vout === s.vout)) {
    s.status = 'REFUNDED';
    s.spendTxid = sent.txid;
  }
}
saveEnvelope(env);
console.log(`Refunded ${utxos.length} share(s) in one refundBatch tx: ${EXPLORER_TX}${sent.txid}`);
process.exit(0);
