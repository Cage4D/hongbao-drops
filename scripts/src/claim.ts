// Claim one share on Chipnet (spec §6.2): link-key signature + gate datasig, no wallet signature.
// Usage: pnpm --filter @hongbao/scripts claim -- --name demo1 [--share 2] [--to bchtest:z…]
import { parseArgs } from 'node:util';
import { hexToBin } from '@bitauth/libauth';
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { gateMessage, signGateApproval } from '@hongbao/contract';
import { EXPLORER_TX } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { newKeyPair } from './lib/keys.js';
import { FEE_RATE, addressToLockingBytecode, envelopeContract, txSize } from './lib/envelope.js';
import { loadEnvelope, saveEnvelope } from './lib/state.js';

const { values: a } = parseArgs({
  options: { name: { type: 'string' }, share: { type: 'string' }, to: { type: 'string' } },
});
const env = loadEnvelope(a.name!);
if (Date.now() / 1000 >= env.expiry) throw new Error('Envelope expired: the gate refuses claims after expiry.');

const share = a.share
  ? env.shares.find((s) => s.index === Number(a.share))
  : env.shares.find((s) => s.status === 'AVAILABLE');
if (!share || share.status !== 'AVAILABLE') throw new Error('No such available share');

// Default recipient: a brand-new wallet (like a newcomer claiming with zero BCH).
const fresh = a.to ? undefined : newKeyPair();
const toAddress = a.to ?? fresh!.tokenAddress;
const recipient = addressToLockingBytecode(toAddress);

const provider = await chipnetProvider();
const contract = envelopeContract(env, provider);
const utxo = (await contract.getUtxos()).find((u) => u.txid === share.txid && u.vout === share.vout);
if (!utxo) throw new Error(`Share ${share.index} not found on-chain (already spent?)`);

// --- What the API gate will do in Phase 4: sign recipient ‖ outpoint with the envelope's gate key.
const gateSig = signGateApproval(hexToBin(env.gatePrivHex), gateMessage(recipient, utxo.txid, utxo.vout));
const linkSigner = new SignatureTemplate(hexToBin(env.linkPrivHex));

const build = (amount: bigint) =>
  new TransactionBuilder({ provider })
    .addInput(utxo, contract.unlock.claim(linkSigner, gateSig))
    .addOutput({ to: recipient, amount, ...(utxo.token && { token: utxo.token }) });
const fee = BigInt(txSize(build(utxo.satoshis - 1_000n))) * FEE_RATE;
const sent = await build(utxo.satoshis - fee).send();

share.status = 'CLAIMED';
share.spendTxid = sent.txid;
saveEnvelope(env);
console.log(`Claimed share #${share.index} (${utxo.satoshis - fee} sats${utxo.token ? ' + stamp NFT' : ''}) → ${toAddress}`);
console.log(`  ${EXPLORER_TX}${sent.txid}   (fee ${fee} sats, paid by the share)`);
if (fresh) console.log(`  claimer WIF (test only): ${fresh.wif}`);
process.exit(0);
