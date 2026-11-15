// Send Chipnet sats from the script wallet (e.g. to top up a WizardConnect test wallet).
// Usage: pnpm --filter @hongbao/scripts send -- --to bchtest:q… --sats 20000
import { parseArgs } from 'node:util';
import { SignatureTemplate, TransactionBuilder, type SpendableUtxo } from 'cashscript';
import { EXPLORER_TX } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { walletKey } from './lib/keys.js';
import { FEE_RATE, addressToLockingBytecode, txSize } from './lib/envelope.js';

const { values: a } = parseArgs({ options: { to: { type: 'string' }, sats: { type: 'string' } } });
if (!a.to || !a.sats) throw new Error('--to and --sats are required');
if (!a.to.startsWith('bchtest:')) throw new Error('Chipnet (bchtest:) addresses only');
const amount = BigInt(a.sats);
const to = addressToLockingBytecode(a.to);

const provider = await chipnetProvider();
const wallet = walletKey();
const signer = new SignatureTemplate(wallet.priv);
// BCH-only UTXOs, largest first; never touches token UTXOs.
const utxos = (await provider.getUtxos(wallet.address)).filter((u) => !u.token).sort((x, y) => Number(y.satoshis - x.satoshis));
const inputs: SpendableUtxo[] = [];
let sum = 0n;
for (const u of utxos) {
  inputs.push(u);
  sum += u.satoshis;
  if (sum >= amount + 2_000n) break;
}
if (sum < amount + 2_000n) throw new Error(`Insufficient funds: ${sum} sats`);

const build = (change: bigint) => {
  const tb = new TransactionBuilder({ provider });
  for (const u of inputs) tb.addInput(u, signer.unlockP2PKH());
  return tb.addOutput({ to, amount }).addOutput({ to: wallet.lockingBytecode, amount: change });
};
const fee = BigInt(txSize(build(sum - amount - 1_000n))) * FEE_RATE;
const sent = await build(sum - amount - fee).send();
console.log(`Sent ${amount} sats → ${a.to}\n  ${EXPLORER_TX}${sent.txid}  (fee ${fee} sats)`);
process.exit(0);
