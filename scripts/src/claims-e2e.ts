// Phase 4 exit check on Chipnet (spec §11.2): 3 parallel claims succeed, the 4th on a 3-share
// envelope gets ENVELOPE_EMPTY, hold → claim works, quiz right/wrong, double-claim rejected.
// Every claimer is a brand-new wallet with zero BCH that never signs anything.
// Needs the API running: pnpm --filter @hongbao/api dev
// Usage: pnpm --filter @hongbao/scripts claims-e2e [-- --api http://localhost:3000]
import { parseArgs } from 'node:util';
import { buildClaimTx } from '@hongbao/contract';
import type { ClaimApproval } from '@hongbao/shared';
import { EXPLORER_TX } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { newKeyPair } from './lib/keys.js';
import { apiClient, check, createAndFund } from './lib/api.js';

const { values: a } = parseArgs({ options: { api: { type: 'string', default: 'http://localhost:3000' } } });
const call = apiClient(a.api!);
const provider = await chipnetProvider();

check((await call('GET', '/health')).body.network === 'CHIPNET', `API up on CHIPNET (${a.api})`);

/** Claimer side: ask the gate, build the claim tx with the link secret, broadcast via the API. */
async function claimAndBroadcast(envelopeId: string, linkPriv: Uint8Array, body: Record<string, unknown>, ip: string) {
  const approval = await call('POST', `/envelopes/${envelopeId}/claims`, body, { 'x-forwarded-for': ip });
  if (approval.status !== 201) return { approval, broadcast: undefined };
  const ap = approval.body as ClaimApproval;
  const { hex } = buildClaimTx({
    provider,
    constructorArgs: ap.constructorArgs,
    share: ap.share,
    recipientLockingBytecode: ap.recipientLockingBytecode,
    linkPrivateKey: linkPriv,
    gateSig: ap.gateSig,
  });
  const broadcast = await call('POST', `/claims/${ap.claimId}/broadcast`, { rawTx: hex });
  return { approval, broadcast };
}

// ------------------------------------------------------------ envelope A: 3 stamped shares
console.log('\nEnvelope A — 3 equal shares with stamps');
const A = await createAndFund(call, provider, { shareCount: 3, mode: 'EQUAL', totalSats: 9_000, theme: 'classic-red', message: 'Phase 4 e2e' });
console.log(`   funded: ${EXPLORER_TX}${A.fundingTxid}  (slug ${A.env.slug})`);

const claimers = [newKeyPair(), newKeyPair(), newKeyPair()];
const results = await Promise.all(
  claimers.map((k, i) => claimAndBroadcast(A.env.id, A.linkPriv, { recipientAddress: k.tokenAddress }, `198.51.100.${i + 1}`)),
);
const shareIdx = new Set(results.map((r) => r.approval.body.share?.index));
check(results.every((r) => r.approval.status === 201) && shareIdx.size === 3, '3 parallel claims approved, 3 different shares');
for (const [i, r] of results.entries()) {
  check(r.broadcast?.status === 200, `claim ${i + 1} broadcast: ${r.broadcast?.body.amountSats} sats + stamp ${r.broadcast?.body.stamp?.commitment} → fresh wallet (isNewWallet=${r.approval.body.isNewWallet})`);
  console.log(`   ${EXPLORER_TX}${r.broadcast?.body.txid}`);
}

const fourth = await call('POST', `/envelopes/${A.env.id}/claims`, { recipientAddress: newKeyPair().tokenAddress }, { 'x-forwarded-for': '198.51.100.9' });
check(fourth.status === 410 && fourth.body.error.code === 'ENVELOPE_EMPTY', `4th claimer → 410 ENVELOPE_EMPTY: "${fourth.body.error.message}"`);

const dbl = await call('POST', `/envelopes/${A.env.id}/claims`, { recipientAddress: claimers[0]!.address }, { 'x-forwarded-for': '198.51.100.1' });
check(
  dbl.status === 409 && dbl.body.error.code === 'ALREADY_CLAIMED',
  `double claim by claimer 1 (plain address form) → 409 ALREADY_CLAIMED: "${dbl.body.error.message}"`,
);

const viewA = await call('GET', `/s/${A.env.slug}`);
check(viewA.body.status === 'EXHAUSTED' && viewA.body.shares.claimed === 3, `envelope A EXHAUSTED, ${viewA.body.recentClaims.length} recent claims listed`);

// ------------------------------------------------------------ envelope B: quiz + hold, double claim
console.log('\nEnvelope B — 2 quiz shares, no stamps');
const B = await createAndFund(call, provider, {
  shareCount: 2,
  mode: 'QUIZ',
  totalSats: 6_000,
  withStamps: false,
  quiz: { question: 'What does BCH stand for?', answers: ['Bitcoin Cash'] },
});
console.log(`   funded: ${EXPLORER_TX}${B.fundingTxid}  (slug ${B.env.slug})`);

const hold = await call('POST', `/envelopes/${B.env.id}/holds`, {}, { 'x-forwarded-for': '203.0.113.7' });
check(hold.status === 201, `hold my share → token until ${hold.body.heldUntil}`);

const newbie = newKeyPair(); // "installed a wallet" after holding
const wrong = await call('POST', `/envelopes/${B.env.id}/claims`, { recipientAddress: newbie.address, holdToken: hold.body.holdToken, answer: 'Big Coin Hype' }, { 'x-forwarded-for': '203.0.113.7' });
check(wrong.status === 403 && wrong.body.error.code === 'WRONG_ANSWER', `wrong answer → 403 WRONG_ANSWER (attemptsLeft ${wrong.body.error.attemptsLeft})`);

const held = await claimAndBroadcast(B.env.id, B.linkPriv, { recipientAddress: newbie.address, holdToken: hold.body.holdToken, answer: ' bitcoin CASH ' }, '203.0.113.7');
check(held.approval.status === 201 && held.broadcast?.status === 200, `hold → claim with right answer: ${held.broadcast?.body.amountSats} sats`);
console.log(`   ${EXPLORER_TX}${held.broadcast?.body.txid}`);

const again = await call('POST', `/envelopes/${B.env.id}/claims`, { recipientAddress: newbie.tokenAddress, answer: 'Bitcoin Cash' }, { 'x-forwarded-for': '203.0.113.8' });
check(again.status === 409 && again.body.error.code === 'ALREADY_CLAIMED', `same wallet again (token-aware form) → 409 ALREADY_CLAIMED: "${again.body.error.message}"`);

console.log('\nAll Phase 4 checks passed on Chipnet. Envelope B has 1 share left; the Phase 5 keeper refunds it after expiry.');
process.exit(0);
