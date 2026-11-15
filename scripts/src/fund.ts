// Create + fund an envelope on Chipnet (spec §6.1, signed locally instead of via WizardConnect).
// Usage: pnpm --filter @hongbao/scripts fund -- --name demo1 --shares 3 --total 30000 [--mode lucky]
//        [--no-stamps] [--expiry-min 20] [--fee-bps 300]
import { parseArgs } from 'node:util';
import { binToHex, generatePrivateKey } from '@bitauth/libauth';
import { SignatureTemplate, TransactionBuilder, type Output, type SpendableUtxo } from 'cashscript';
import {
  DEFAULT_MAX_FEE,
  IDENTITY_OUTPUT_SATS,
  MIN_SHARE_SATS_NO_STAMP,
  MIN_SHARE_SATS_WITH_STAMP,
  bcmrRegistryHash,
  equalSplit,
  fundingOutputs,
  luckySplit,
  shareOutputIndex,
} from '@hongbao/contract';
import { EXPLORER_TX, PUBLIC_API_URL } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { treasuryKey, walletKey } from './lib/keys.js';
import { FEE_RATE, envelopeContract, txSize } from './lib/envelope.js';
import { nextSeq, saveEnvelope, type EnvelopeState } from './lib/state.js';

const { values: a } = parseArgs({
  options: {
    name: { type: 'string' },
    shares: { type: 'string', default: '3' },
    total: { type: 'string', default: '30000' },
    mode: { type: 'string', default: 'equal' },
    'no-stamps': { type: 'boolean', default: false },
    'expiry-min': { type: 'string', default: '20' },
    'fee-bps': { type: 'string', default: '0' },
  },
});
const shareCount = Number(a.shares);
const total = BigInt(a.total!);
const withStamps = !a['no-stamps'];
const feeBps = BigInt(a['fee-bps']!);
const name = a.name ?? `env-${Date.now()}`;

const provider = await chipnetProvider();
const wallet = walletKey();
const treasury = treasuryKey();
const signer = new SignatureTemplate(wallet.priv);

let utxos: SpendableUtxo[] = (await provider.getUtxos(wallet.address)).filter((u) => !u.token);
const balance = utxos.reduce((s, u) => s + u.satoshis, 0n);
const sponsorFeeSats = (total * feeBps) / 10_000n;
const needed = total + sponsorFeeSats + (withStamps ? IDENTITY_OUTPUT_SATS : 0n) + 3_000n;
if (balance < needed) {
  console.error(`Wallet ${wallet.address} has ${balance} sats; need ~${needed}. Run \`pnpm wallet\` and use a faucet.`);
  process.exit(1);
}

// --- CashTokens genesis needs input 0 to spend a vout-0 outpoint. If we have none, consolidate
// everything into one self-send ("prep" tx): its single output is at vout 0.
let prepTxid: string | undefined;
let input0 = utxos.find((u) => u.vout === 0 && u.satoshis >= needed);
if (withStamps && !input0) {
  const prep = new TransactionBuilder({ provider });
  for (const u of utxos) prep.addInput(u, signer.unlockP2PKH());
  prep.addOutput({ to: wallet.lockingBytecode, amount: balance - 1_000n });
  const size = BigInt(txSize(prep));
  const prepTb = new TransactionBuilder({ provider });
  for (const u of utxos) prepTb.addInput(u, signer.unlockP2PKH());
  prepTb.addOutput({ to: wallet.lockingBytecode, amount: balance - size * FEE_RATE });
  const sent = await prepTb.send();
  prepTxid = sent.txid;
  console.log(`prep tx (vout-0 outpoint for genesis): ${EXPLORER_TX}${prepTxid}`);
  input0 = { txid: prepTxid, vout: 0, satoshis: balance - size * FEE_RATE, lockingBytecode: binToHex(wallet.lockingBytecode) };
  utxos = [input0];
}
const inputs = withStamps ? [input0!, ...utxos.filter((u) => u !== input0)] : utxos;

// --- Envelope keys and contract. In the product the link key is made in the sender's browser
// and the gate key is derived by the API; Phase 2 generates both locally.
const seq = nextSeq();
const linkPriv = generatePrivateKey();
const gatePriv = generatePrivateKey();
const expiry = Math.floor(Date.now() / 1000) + Number(a['expiry-min']) * 60;
const state: Omit<EnvelopeState, 'fundingTxid' | 'contractAddress' | 'shares'> = {
  name,
  seq,
  createdAt: new Date().toISOString(),
  linkPrivHex: binToHex(linkPriv),
  gatePrivHex: binToHex(gatePriv),
  refundLockingBytecodeHex: binToHex(wallet.lockingBytecode),
  expiry,
  maxFee: DEFAULT_MAX_FEE.toString(),
  withStamps,
  prepTxid,
};
const contract = envelopeContract({ ...state, fundingTxid: '', contractAddress: '', shares: [] }, provider);

// --- Share amounts
const minShare = withStamps ? MIN_SHARE_SATS_WITH_STAMP : MIN_SHARE_SATS_NO_STAMP;
const shareAmounts = a.mode === 'lucky' ? luckySplit(total, shareCount, minShare) : equalSplit(total, shareCount);

// --- Stamps: category = txid of input 0; minimal BCMR registry (Phase 6 serves the real one).
let stamps: Parameters<typeof fundingOutputs>[0]['stamps'];
let bcmrRegistry: string | undefined;
if (withStamps) {
  const category = input0!.txid;
  bcmrRegistry = JSON.stringify({
    $schema: 'https://cashtokens.org/bcmr-v2.schema.json',
    version: { major: 0, minor: 1, patch: 0 },
    latestRevision: new Date().toISOString(),
    registryIdentity: { name: 'Hongbao Drops', description: 'Hongbao stamp registry (Phase 2 test)' },
    identities: {
      [category]: {
        [new Date().toISOString()]: {
          name: `Hongbao Stamp #${seq}`,
          description: 'Proof you caught a Hongbao red envelope.',
          token: { category, symbol: 'HBSTAMP' },
        },
      },
    },
  });
  const host = PUBLIC_API_URL.replace(/^https?:\/\//, '');
  stamps = {
    category,
    envelopeSeq: seq,
    identityLockingBytecode: treasury.lockingBytecode,
    bcmr: { registryHash: bcmrRegistryHash(new TextEncoder().encode(bcmrRegistry)), uris: [`${host}/bcmr/${category}.json`] },
  };
}

const outputs: Output[] = fundingOutputs({
  contract,
  shareAmounts,
  stamps,
  ...(sponsorFeeSats > 0n && { sponsorFee: { lockingBytecode: treasury.lockingBytecode, amount: sponsorFeeSats } }),
});
const inSum = inputs.reduce((s, u) => s + u.satoshis, 0n);
const outSum = outputs.reduce((s, o) => s + o.amount, 0n);

const build = (change: bigint) => {
  const tb = new TransactionBuilder({ provider });
  for (const u of inputs) tb.addInput(u, signer.unlockP2PKH());
  tb.addOutputs(outputs).addOutput({ to: wallet.lockingBytecode, amount: change });
  return tb;
};
const fee = BigInt(txSize(build(inSum - outSum - 1_000n))) * FEE_RATE;
const sent = await build(inSum - outSum - fee).send();

const final: EnvelopeState = {
  ...state,
  stampCategory: stamps?.category,
  bcmrRegistry,
  fundingTxid: sent.txid,
  contractAddress: contract.tokenAddress,
  shares: shareAmounts.map((sats, i) => ({
    index: i + 1,
    txid: sent.txid,
    vout: shareOutputIndex(i, withStamps),
    sats: sats.toString(),
    commitment: outputs[shareOutputIndex(i, withStamps)]!.token?.nft?.commitment,
    status: 'AVAILABLE',
  })),
};
saveEnvelope(final);

console.log(`\nEnvelope "${name}" (seq ${seq}) funded: ${EXPLORER_TX}${sent.txid}`);
console.log(`  contract: ${contract.tokenAddress}`);
console.log(`  shares:   ${shareAmounts.join(', ')} sats${withStamps ? `  stamps: ${stamps!.category}` : ''}`);
console.log(`  expiry:   ${new Date(expiry * 1000).toISOString()}   fee paid: ${fee} sats`);
process.exit(0);
