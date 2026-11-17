// Phase 7 exit check on Chipnet: seed a real sponsored campaign through the API, then check the
// stats, CSV and public page agree with each other AND with the chain (every txid fetched from
// Fulcrum and decoded). Needs the API running (with KEEPER_TOKEN and CLIENT_IP_HEADER set).
// Usage: pnpm --filter @hongbao/scripts campaign-e2e [-- --api http://localhost:3000]
import { parseArgs } from 'node:util';
import { binToHex, cashAddressToLockingBytecode, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { buildClaimTx } from '@hongbao/contract';
import type { CampaignStats, ClaimApproval } from '@hongbao/shared';
import { EXPLORER_TX } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { newKeyPair, treasuryKey, walletKey, type KeyPair } from './lib/keys.js';
import { apiClient, check, createAndFund } from './lib/api.js';

// --single-ip: against a host that overwrites X-Forwarded-For (Vercel), every request comes from this
// machine's one real IP. Expect the farm detector to flag the 4-claim burst and CTA clicks to count once.
const { values: a } = parseArgs({
  options: { api: { type: 'string', default: 'http://localhost:3000' }, 'single-ip': { type: 'boolean', default: false } },
});
const SINGLE_IP = a['single-ip']!;
const call = apiClient(a.api!);
const provider = await chipnetProvider();
const KEEPER = { authorization: `Bearer ${process.env.KEEPER_TOKEN}` };

// ------------------------------------------------------------ sponsor + campaign
const sp = await call('POST', '/sponsors', { name: 'BLAZE Demo Co', brandColor: '#0AC18E', ctaLabel: 'Learn more', ctaUrl: 'https://bchblaze.cash' });
check(sp.status === 201, `sponsor created (token shown once: ${sp.body.sponsorToken.slice(0, 8)}…)`);
const auth = { authorization: `Bearer ${sp.body.sponsorToken}` };
const cid = (await call('POST', '/campaigns', { name: 'BLAZE Drop (Chipnet)' }, auth)).body.campaignId as string;
check(!!cid, `campaign ${cid}`);
const sponsored = { sponsorToken: sp.body.sponsorToken, campaignId: cid };

const e1 = await createAndFund(call, provider, { ...sponsored, shareCount: 3, mode: 'EQUAL', totalSats: 18_000, withStamps: false, theme: 'gold', message: 'BLAZE Drop: welcome to BCH!' });
console.log(`   envelope 1 funded (3% fee to treasury): ${EXPLORER_TX}${e1.fundingTxid}`);
const e2 = await createAndFund(call, provider, { ...sponsored, shareCount: 2, mode: 'LUCKY', totalSats: 8_000, withStamps: false, theme: 'gold' });
console.log(`   envelope 2 funded: ${EXPLORER_TX}${e2.fundingTxid}`);

// ------------------------------------------------------------ claims
async function claim(env: typeof e1, to: string, ip: string) {
  const ap = (await call('POST', `/envelopes/${env.env.id}/claims`, { recipientAddress: to }, { 'x-forwarded-for': ip })).body as ClaimApproval;
  const { hex } = buildClaimTx({ provider, constructorArgs: ap.constructorArgs, share: ap.share, recipientLockingBytecode: ap.recipientLockingBytecode, linkPrivateKey: env.linkPriv, gateSig: ap.gateSig });
  const b = await call('POST', `/claims/${ap.claimId}/broadcast`, { rawTx: hex });
  if (b.status !== 200) throw new Error(JSON.stringify(b.body));
  return { txid: b.body.txid as string, amount: BigInt(b.body.amountSats), fresh: ap.isNewWallet };
}
const alice = newKeyPair();
const bob = newKeyPair();
const carol = newKeyPair();
const cA = await claim(e1, alice.tokenAddress, '198.51.100.11');
const cB = await claim(e1, bob.tokenAddress, '198.51.100.12');
const cOld = await claim(e1, walletKey().address, '198.51.100.13'); // existing wallet → not fresh
const cC = await claim(e2, carol.tokenAddress, '198.51.100.14');
check(cA.fresh === true && cB.fresh === true && cC.fresh === true && cOld.fresh === false, '4 claims: 3 fresh wallets + 1 existing wallet');

// Alice spends her coins (activation). Bob passes it on (activation + reach).
async function spend(k: KeyPair, txid: string, amount: bigint, to: Uint8Array) {
  const utxos = (await provider.getUtxos(k.tokenAddress)).filter((u) => u.txid === txid);
  const tb = new TransactionBuilder({ provider });
  for (const u of utxos) tb.addInput(u, new SignatureTemplate(k.priv).unlockP2PKH());
  const token = utxos.find((u) => u.token)?.token;
  tb.addOutput({ to, amount: amount - 500n, ...(token && { token }) });
  return (await tb.send()).txid;
}
const shopLB = cashAddressToLockingBytecode(newKeyPair().tokenAddress);
if (typeof shopLB === 'string') throw new Error(shopLB);
console.log(`   alice spends her BCH: ${EXPLORER_TX}${await spend(alice, cA.txid, cA.amount, shopLB.bytecode)}`);
const child = await createAndFund(call, provider, { shareCount: 2, mode: 'EQUAL', totalSats: 3_000, withStamps: false, parentEnvelopeId: e1.env.id }, bob);
console.log(`   bob passes it on: ${EXPLORER_TX}${child.fundingTxid}`);

for (const ip of ['203.0.113.1', '203.0.113.1', '203.0.113.2']) await call('POST', `/envelopes/${e1.env.id}/cta-click`, undefined, { 'x-forwarded-for': ip });
const tick = await call('POST', '/internal/keeper/tick', undefined, KEEPER);
check(tick.status === 200 && tick.body.errors.length === 0, `keeper tick: activation ${JSON.stringify(tick.body.activation)}`);

// ------------------------------------------------------------ stats
const st = (await call('GET', `/campaigns/${cid}/stats`, undefined, auth)).body as CampaignStats;
console.log('\nCampaign stats');
console.table({
  claims: st.claims,
  freshWallets: st.freshWallets,
  activatedWallets: st.activatedWallets,
  activatedNotFarm: st.activatedNotFarm,
  pendingActivation: st.pendingActivation,
  suspectedFarms: st.suspectedFarms,
  givenAwaySats: st.givenAwaySats,
  feesSats: st.feesSats,
  spentSats: st.spentSats,
  spentUsd: st.spentUsd,
  costPerActivatedNewWalletUsd: st.costPerActivatedNewWalletUsd,
  costPerFreshWalletUsd: st.costPerFreshWalletUsd,
  ctaClicks: st.ctaClicks,
  passOnEnvelopes: st.passOnEnvelopes,
  totalReach: st.totalReach,
});
if (SINGLE_IP) {
  check(
    st.claims === 4 && st.freshWallets === 3 && st.activatedWallets === 2 && st.suspectedFarms === 4 && st.activatedNotFarm === 0,
    'funnel: 4 claims → 3 fresh → 2 activated; all 4 flagged as farm (one real IP, burst) → 0 not farm',
  );
} else {
  check(st.claims === 4 && st.freshWallets === 3 && st.activatedWallets === 2 && st.activatedNotFarm === 2, 'funnel: 4 claims → 3 fresh → 2 activated → 2 not farm');
}
const askedFees = [e1, e2].reduce((sum, e) => sum + (e.env.requiredOutputs.find((o) => o.purpose === 'SPONSOR_FEE')?.sats ?? 0), 0);
check(st.feesSats === askedFees && st.spentSats === st.givenAwaySats + st.feesSats, `fees = what the API required (max(3%, 546) each = ${askedFees}); spent = given away + fees`);
if (SINGLE_IP) check(st.passOnEnvelopes === 1 && st.ctaClicks === 1, 'pass-on counted; 3 CTA clicks with 2 spoofed IPs → 1 (X-Forwarded-For spoofing ignored)');
else check(st.passOnEnvelopes === 1 && st.ctaClicks === 2, 'pass-on and CTA counted (3 clicks from 2 IPs → 2)');

// ------------------------------------------------------------ reconcile with the chain
console.log('\nReconciling with Chipnet…');
const csv = await fetch(`${a.api}/campaigns/${cid}/export.csv`, { headers: auth }).then((r) => r.text());
const [head, ...rows] = csv.trim().split('\n');
const cols = head!.split(',');
const col = (row: string, name: string) => row.split(',')[cols.indexOf(name)]!;
check(rows.length === st.claims, `CSV has one row per claim (${rows.length})`);
let csvShareSats = 0n;
for (const row of rows) {
  const txid = col(row, 'claim_txid');
  const tx = decodeTransaction(hexToBin(await provider.getRawTransaction(txid)));
  if (typeof tx === 'string') throw new Error(tx);
  const lb = cashAddressToLockingBytecode(col(row, 'recipient_address'));
  if (typeof lb === 'string') throw new Error(lb);
  const out = tx.outputs[0]!;
  check(
    binToHex(out.lockingBytecode) === binToHex(lb.bytecode) && out.valueSatoshis === BigInt(col(row, 'received_sats')) &&
      binToHex(tx.inputs[0]!.outpointTransactionHash) + ':' + tx.inputs[0]!.outpointIndex === col(row, 'share_outpoint'),
    `claim ${txid.slice(0, 10)}… spends ${col(row, 'share_outpoint').slice(0, 10)}… and pays ${out.valueSatoshis} sats to ${col(row, 'recipient_address').slice(0, 18)}…`,
  );
  csvShareSats += BigInt(col(row, 'share_sats'));
}
check(csvShareSats === BigInt(st.givenAwaySats), `Σ claimed share sats on-chain = givenAwaySats (${csvShareSats})`);

const treasury = binToHex(treasuryKey().lockingBytecode);
let feesOnChain = 0n;
for (const e of [e1, e2]) {
  const tx = decodeTransaction(hexToBin(await provider.getRawTransaction(e.fundingTxid)));
  if (typeof tx === 'string') throw new Error(tx);
  // The fee output sits where the API said it must (after the shares); it pays the treasury.
  const feeIdx = e.env.requiredOutputs.find((o) => o.purpose === 'SPONSOR_FEE')!.outputIndex;
  const fee = tx.outputs[feeIdx]!;
  if (binToHex(fee.lockingBytecode) !== treasury) throw new Error(`fee output of ${e.fundingTxid} doesn't pay the treasury`);
  feesOnChain += fee.valueSatoshis;
}
check(feesOnChain === BigInt(st.feesSats), `Σ sponsor-fee outputs to the treasury on-chain = feesSats (${feesOnChain})`);

const pub = await call('GET', `/campaigns/${cid}/public`);
const pubText = JSON.stringify(pub.body);
check(
  pub.body.costPerActivatedNewWalletUsd === st.costPerActivatedNewWalletUsd && ![alice, bob, carol].some((k) => pubText.includes(k.address.split(':')[1]!.slice(0, 20))),
  `public proof-of-reach page: same numbers, no addresses (${a.api}/campaigns/${cid}/public)`,
);
console.log(`\nAll Phase 7 checks passed on Chipnet. Campaign ${cid}.`);
process.exit(0);
