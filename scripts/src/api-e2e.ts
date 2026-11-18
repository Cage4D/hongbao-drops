// Phase 3 exit check on Chipnet: an envelope created through the API becomes ACTIVE only after the
// API verifies its funding tx on-chain. Needs the API running (pnpm --filter @hongbao/api dev).
// Usage: pnpm --filter @hongbao/scripts api-e2e [-- --api http://localhost:3000] [--no-seals]
import { parseArgs } from 'node:util';
import { binToHex, generatePrivateKey, hexToBin, secp256k1 } from '@bitauth/libauth';
import { SignatureTemplate, TransactionBuilder, type Output, type SpendableUtxo } from 'cashscript';
import type { CreateEnvelopeResponse } from '@hongbao/shared';
import { EXPLORER_TX } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { walletKey } from './lib/keys.js';
import { FEE_RATE, draftFee, txSize } from './lib/envelope.js';

const { values: a } = parseArgs({
  options: { api: { type: 'string', default: 'http://localhost:3000' }, 'no-seals': { type: 'boolean', default: false } },
});
const API = a.api!;
const withSeals = !a['no-seals'];

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) process.exit(1);
};

const health = await call('GET', '/health');
check(health.body.ok && health.body.network === 'CHIPNET', `API healthy on CHIPNET (${API}, chain ${health.body.chain?.server})`);

const provider = await chipnetProvider();
const wallet = walletKey();
const signer = new SignatureTemplate(wallet.priv);
let utxos: SpendableUtxo[] = (await provider.getUtxos(wallet.address)).filter((u) => !u.token);

// Seal genesis needs input 0 at vout 0: consolidate into one self-send if necessary.
let input0 = utxos.find((u) => u.vout === 0 && u.satoshis > 20_000n);
if (withSeals && !input0) {
  const total = utxos.reduce((s, u) => s + u.satoshis, 0n);
  const mkPrep = (amt: bigint) => {
    const tb = new TransactionBuilder({ provider });
    for (const u of utxos) tb.addInput(u, signer.unlockP2PKH());
    return tb.addOutput({ to: wallet.lockingBytecode, amount: amt });
  };
  const prepFee = BigInt(txSize(mkPrep(total - draftFee(utxos.length)))) * FEE_RATE;
  const prep = await mkPrep(total - prepFee).send();
  console.log(`   prep tx: ${EXPLORER_TX}${prep.txid}`);
  input0 = { txid: prep.txid, vout: 0, satoshis: total - prepFee, lockingBytecode: binToHex(wallet.lockingBytecode) };
  utxos = [input0];
}
input0 ??= utxos[0]!;

// --- 1. Create via API (link key generated "in the browser" = here; only its pubkey is sent).
const linkPriv = generatePrivateKey();
const body = {
  senderAddress: wallet.address,
  linkPk: binToHex(secp256k1.derivePublicKeyCompressed(linkPriv) as Uint8Array),
  shareCount: 3,
  mode: 'EQUAL',
  totalSats: 9_000,
  expiry: Math.floor(Date.now() / 1000) + 15 * 60,
  message: 'Phase 3 API e2e',
  theme: 'gold',
  withSeals,
  ...(withSeals && { sealCategory: input0.txid }),
};
const created = await call('POST', '/envelopes', body);
check(created.status === 201, `POST /envelopes → 201 (slug ${created.body.slug}, seq ${created.body.envelopeSeq})`);
const env = created.body as CreateEnvelopeResponse;
const decoy = (await call('POST', '/envelopes', { ...body, withSeals: false, sealCategory: undefined }))
  .body as CreateEnvelopeResponse;

// --- 2. Not funded yet.
const early = await call('POST', `/envelopes/${env.id}/funded`, { txid: '00'.repeat(32) });
check(early.status === 409 && early.body.error.code === 'NOT_FUNDED', 'unknown txid → 409 NOT_FUNDED');
check((await call('GET', `/envelopes/${env.id}`)).body.status === 'PENDING_FUNDING', 'status still PENDING_FUNDING');

// --- 3. Build the funding tx exactly from the API's template, sign locally, broadcast.
const outs: Output[] = env.fundingTemplate.map((o) => ({
  to: hexToBin(o.lockingBytecode),
  amount: BigInt(o.sats),
  ...(o.token && {
    token: { category: o.token.category, amount: 0n, nft: { capability: 'none' as const, commitment: o.token.nftCommitment } },
  }),
}));
const inputs = [input0, ...utxos.filter((u) => u !== input0)];
const inSum = inputs.reduce((s, u) => s + u.satoshis, 0n);
const outSum = outs.reduce((s, o) => s + o.amount, 0n);
const mk = (change: bigint) => {
  const tb = new TransactionBuilder({ provider });
  for (const u of inputs) tb.addInput(u, signer.unlockP2PKH());
  return tb.addOutputs(outs).addOutput({ to: wallet.lockingBytecode, amount: change });
};
const fee = BigInt(txSize(mk(inSum - outSum - draftFee(inputs.length)))) * FEE_RATE;
const sent = await mk(inSum - outSum - fee).send();
console.log(`   funding tx: ${EXPLORER_TX}${sent.txid}`);

// --- 4. The same tx can't activate a different envelope.
const wrong = await call('POST', `/envelopes/${decoy.id}/funded`, { txid: sent.txid });
check(
  wrong.status === 422 && wrong.body.error.code === 'FUNDING_MISMATCH',
  `funding tx against another envelope → 422 FUNDING_MISMATCH (${wrong.body.error?.reasons?.[0]})`,
);

// --- 5. Verify → ACTIVE.
const funded = await call('POST', `/envelopes/${env.id}/funded`, { txid: sent.txid });
check(funded.status === 200 && funded.body.status === 'ACTIVE', `POST /funded → ACTIVE with ${funded.body.shares?.length} shares`);
for (const s of funded.body.shares) {
  console.log(`   share ${s.index}: ${s.outpoint} ${s.sats} sats ($${s.usd})${s.nftCommitment ? ` seal ${s.nftCommitment}` : ''}`);
}

const view = await call('GET', `/s/${env.slug}`);
check(
  view.body.status === 'ACTIVE' && view.body.remaining.sats === 9_000,
  `GET /s/${env.slug} → ACTIVE, ${view.body.remaining.sats} sats ($${view.body.remaining.usd}) left`,
);
console.log(`\nEnvelope ${env.id} (slug ${env.slug}) is live on Chipnet. The Phase 5 keeper refunds it after expiry.`);
process.exit(0);
