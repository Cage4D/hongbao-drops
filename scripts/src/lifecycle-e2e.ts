// Phase 5 exit check on Chipnet: (1) an expired envelope auto-refunds in one batch tx via the
// keeper, (2) the SSE stream shows claim events, (3) /tree returns a 2-generation chain.
// Needs the API running with KEEPER_TOKEN set (pnpm --filter @hongbao/api dev).
// Usage: pnpm --filter @hongbao/scripts lifecycle-e2e [-- --api http://localhost:3000]
import { parseArgs } from 'node:util';
import { buildClaimTx } from '@hongbao/contract';
import type { ClaimApproval, TreeResponse } from '@hongbao/shared';
import { EXPLORER_TX } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { newKeyPair } from './lib/keys.js';
import { apiClient, check, createAndFund } from './lib/api.js';

const { values: a } = parseArgs({ options: { api: { type: 'string', default: 'http://localhost:3000' } } });
const API = a.api!;
const call = apiClient(API);
const provider = await chipnetProvider();
const KEEPER_TOKEN = process.env.KEEPER_TOKEN;
if (!KEEPER_TOKEN) throw new Error('KEEPER_TOKEN missing from .env');

// ------------------------------------------------------------ 1. keeper refunds expired envelopes
console.log('\n1. Keeper tick (expired envelopes from Phases 3–4 are waiting)');
const tick = await call('POST', '/internal/keeper/tick', undefined, { authorization: `Bearer ${KEEPER_TOKEN}` });
check(tick.status === 200 && tick.body.ran, `tick ran in ${tick.body.ms} ms (errors: ${tick.body.errors?.length ?? 0})`);
for (const r of tick.body.refunds ?? []) console.log(`   refunded ${r.shares} share(s), ${r.sats} sats in one refundBatch tx: ${EXPLORER_TX}${r.txid}`);
check((tick.body.refunds?.length ?? 0) > 0, `${tick.body.refunds?.length} expired envelope(s) refunded automatically (waiting on MTP: ${tick.body.refundsWaiting})`);
if (tick.body.errors?.length) console.log('   errors:', tick.body.errors);
const health = await call('GET', '/health');
check(!!health.body.keeper.lastRunAt, `/health shows keeper heartbeat ${health.body.keeper.lastRunAt}`);

// ------------------------------------------------------------ 2. SSE shows claims
console.log('\n2. Live events');
const root = await createAndFund(call, provider, { shareCount: 2, mode: 'EQUAL', totalSats: 20_000, withStamps: false, message: 'Pass it on!' });
console.log(`   root envelope funded: ${EXPLORER_TX}${root.fundingTxid} (slug ${root.env.slug})`);

const events: { event: string; data: Record<string, unknown> }[] = [];
const ac = new AbortController();
const streamDone = (async () => {
  const res = await fetch(`${API}/envelopes/${root.env.id}/events?maxSeconds=25`, { signal: ac.signal });
  const reader = res.body!.getReader();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done) break;
    buf += new TextDecoder().decode(value);
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (ev && data) {
        events.push({ event: ev, data: JSON.parse(data) });
        console.log(`   SSE ← ${ev} ${data.slice(0, 140)}`);
      }
    }
  }
})();
await new Promise((r) => setTimeout(r, 1_000));

const claimer = newKeyPair(); // a brand-new wallet
const ap = (await call('POST', `/envelopes/${root.env.id}/claims`, { recipientAddress: claimer.tokenAddress }, { 'x-forwarded-for': '198.51.100.77' })).body as ClaimApproval;
const { hex } = buildClaimTx({ provider, constructorArgs: ap.constructorArgs, share: ap.share, recipientLockingBytecode: ap.recipientLockingBytecode, linkPrivateKey: root.linkPriv, gateSig: ap.gateSig });
const claimed = await call('POST', `/claims/${ap.claimId}/broadcast`, { rawTx: hex });
check(claimed.status === 200, `claimed ${claimed.body.amountSats} sats → fresh wallet: ${EXPLORER_TX}${claimed.body.txid}`);

// ------------------------------------------------------------ 3. claimer passes it on
console.log('\n3. Pass it on');
const child = await createAndFund(
  call,
  provider,
  { shareCount: 2, mode: 'LUCKY', totalSats: 6_000, withStamps: false, parentEnvelopeId: root.env.id, message: 'Re-gifted!' },
  claimer,
);
console.log(`   claimer re-gifted from their claimed coins: ${EXPLORER_TX}${child.fundingTxid} (slug ${child.env.slug})`);

await new Promise((r) => setTimeout(r, 2_500));
ac.abort();
await streamDone;
check(events.some((e) => e.event === 'claimed' && e.data.txid === claimed.body.txid), 'SSE delivered the claim event live');
check(events.some((e) => e.event === 'passedOn' && e.data.childId === child.env.id), 'SSE delivered the passedOn event');

const tree = (await call('GET', `/envelopes/${child.env.id}/tree`)).body as TreeResponse;
check(
  tree.generations === 2 && tree.rootId === root.env.id && tree.nodes.length === 2,
  `tree: ${tree.generations} generations, reach ${tree.totalReach}, ${tree.passOnEnvelopes} pass-on, viral coefficient ${tree.viralCoefficient}`,
);
for (const n of tree.nodes) console.log(`   gen ${n.generation}: ${n.slug} ${n.totalSats} sats × ${n.shareCount} shares, ${n.claims} claim(s)`);

const t2 = await call('POST', '/internal/keeper/tick', undefined, { authorization: `Bearer ${KEEPER_TOKEN}` });
console.log(`\n   next tick: activation ${JSON.stringify(t2.body.activation)} (claimer passed it on → activated)`);
console.log('\nAll Phase 5 checks passed on Chipnet.');
process.exit(0);
