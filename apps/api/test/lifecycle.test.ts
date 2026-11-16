// Phase 5: keeper (refunds, cleanup, reconciliation, activation, farm flags), SSE, pass-it-on tree.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignatureTemplate, TransactionBuilder, type MockNetworkProvider } from 'cashscript';
import { binToHex, decodeTransaction, hexToBin, sha256 } from '@bitauth/libauth';
import { buildClaimTx } from '@hongbao/contract';
import type { ClaimApproval, CreateEnvelopeResponse, TreeResponse } from '@hongbao/shared';
import { farmFlags } from '../src/keeper/farm-flags.js';
import type { TickSummary } from '../src/keeper/keeper.service.js';
import {
  addSenderUtxo,
  addressOf,
  broadcastReq,
  claimReq,
  createBody,
  fundFromTemplate,
  fundedEnvelope,
  key,
  linkPriv,
  makeApp,
  p2pkh,
  pub,
  resetDb,
  sender,
} from './helpers.js';

const KEEPER_TOKEN = 'k'.repeat(32);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

type Hist = { tx_hash: string; height: number }[];
/** Give the mock network an address history (Fulcrum get_history) by watching broadcasts. */
function trackHistory(provider: MockNetworkProvider) {
  const hist = new Map<string, Hist>();
  const outLB = new Map<string, string>();
  const add = (lb: string, txid: string) => {
    const list = hist.get(lb) ?? [];
    if (!list.some((h) => h.tx_hash === txid)) list.push({ tx_hash: txid, height: 0 });
    hist.set(lb, list);
  };
  const orig = provider.sendRawTransaction.bind(provider);
  provider.sendRawTransaction = async (hex: string) => {
    const txid = await orig(hex);
    const tx = decodeTransaction(hexToBin(hex));
    if (typeof tx !== 'string') {
      tx.outputs.forEach((o, i) => {
        const lb = binToHex(o.lockingBytecode);
        outLB.set(`${txid}:${i}`, lb);
        add(lb, txid);
      });
      tx.inputs.forEach((inp) => {
        const lb = outLB.get(`${binToHex(inp.outpointTransactionHash)}:${inp.outpointIndex}`);
        if (lb) add(lb, txid);
      });
    }
    return txid;
  };
  Object.assign(provider, { history: async (lb: string) => hist.get(lb) ?? [] });
  return { mineAll: () => hist.forEach((l) => l.forEach((h) => (h.height = 1))) };
}

let t: Awaited<ReturnType<typeof makeApp>>;
let chain: ReturnType<typeof trackHistory>;
let mtp = 0;
beforeAll(async () => {
  t = await makeApp({ MIN_EXPIRY_SECONDS: '1', KEEPER_TOKEN });
  chain = trackHistory(t.provider);
  Object.assign(t.provider, { medianTimePast: async () => mtp });
});
afterAll(async () => t.app.close());
beforeEach(async () => {
  await resetDb(t.db);
  mtp = now() + 3600; // refunds final by default
});

const tick = async (): Promise<TickSummary> => {
  const r = await t.http().post('/internal/keeper/tick').set('authorization', `Bearer ${KEEPER_TOKEN}`);
  expect(r.status).toBe(200);
  return r.body;
};
const claimAndBroadcast = async (envId: string, who: string) => {
  const a = (await claimReq(t, envId, { recipientAddress: addressOf(who) }, `10.1.0.${who.length}`)).body as ClaimApproval;
  const b = await broadcastReq(t, a);
  expect(b.status).toBe(200);
  return { approval: a, txid: b.body.txid as string, amount: BigInt(b.body.amountSats) };
};
/** Claimer moves their claimed coins somewhere (activation). */
const spendClaim = async (who: string, claimTxid: string, amount: bigint, to: Uint8Array) => {
  const lb = binToHex(p2pkh(pub(key(who))));
  const [u] = (await t.provider.getUtxosForLockingBytecode(lb)).filter((x) => x.txid === claimTxid);
  await new TransactionBuilder({ provider: t.provider })
    .addInput(u!, new SignatureTemplate(key(who)).unlockP2PKH())
    .addOutput({ to, amount: amount - 400n, ...(u!.token && { token: u!.token }) })
    .send();
};

describe('keeper endpoint', () => {
  it('requires the bearer token', async () => {
    expect((await t.http().post('/internal/keeper/tick')).status).toBe(401);
    expect((await t.http().post('/internal/keeper/tick').set('authorization', 'Bearer nope')).status).toBe(401);
    const s = await tick();
    expect(s.ran).toBe(true);
    expect((await t.http().get('/health')).body.keeper.lastRunAt).toBeTruthy();
  });

  it('runs one tick at a time (lease)', async () => {
    const [a, b] = await Promise.all([tick(), tick()]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
  });
});

describe('batch refunds', () => {
  it('waits for median-time-past, then refunds all unclaimed stamped shares to the sender in one tx', async () => {
    const env = await fundedEnvelope(t, { withStamps: true, expiry: now() + 2 });
    await claimAndBroadcast(env.id, 'alice');
    await sleep(2_200);

    mtp = env.constructorArgs.expiry - 60; // network wouldn't accept it yet
    const waiting = await tick();
    expect(waiting.refunds).toEqual([]);
    expect(waiting.refundsWaiting).toBe(1);

    mtp = now() + 600;
    const s = await tick();
    expect(s.refunds).toHaveLength(1);
    expect(s.refunds![0]).toMatchObject({ envelopeId: env.id, shares: 2 });

    const refunded = (await t.provider.getUtxosForLockingBytecode(binToHex(sender))).filter((u) => u.token);
    expect(refunded.map((u) => u.token!.nft!.commitment).sort()).toEqual(
      env.fundingTemplate.filter((o) => o.token).map((o) => o.token!.nftCommitment).slice(1).sort(),
    );
    const row = await t.db.envelope.findUniqueOrThrow({ where: { id: env.id }, include: { shares: true } });
    expect(row.status).toBe('REFUNDED');
    expect(row.shares.map((s) => s.status).sort()).toEqual(['CLAIMED', 'REFUNDED', 'REFUNDED']);
    expect(row.refundedSats).toBeGreaterThan(19_000n);
    const ev = await t.db.event.findFirstOrThrow({ where: { envelopeId: env.id, type: 'refunded' } });
    expect(ev.payload).toMatchObject({ txid: s.refunds![0]!.txid, shares: 2 });

    expect((await tick()).refunds).toEqual([]); // nothing left
  });

  it('refunds a sponsored drop whose funding skipped the fee (never ACTIVE): "funds return after expiry"', async () => {
    const token = 'sponsor-token-xyz';
    await t.db.sponsor.create({ data: { name: 'Acme', adminToken: binToHex(sha256.hash(new TextEncoder().encode(token))) } });
    const utxo = addSenderUtxo(t.provider);
    const res = await t.http().post('/envelopes').send(createBody({ sponsorToken: token, totalSats: 30_000, expiry: now() + 2 }));
    const created = res.body as CreateEnvelopeResponse;
    const txid = await fundFromTemplate(t.provider, created, utxo, (o) => o.slice(0, 3)); // no fee output
    expect((await t.http().post(`/envelopes/${created.id}/funded`).send({ txid })).body.error.code).toBe('FUNDING_MISMATCH');
    expect((await claimReq(t, created.id, { recipientAddress: addressOf('x') })).body.error.code).toBe('NOT_FUNDED');

    await sleep(2_200);
    const s = await tick();
    expect(s.refunds).toEqual([expect.objectContaining({ envelopeId: created.id, shares: 3 })]);
    expect((await t.db.envelope.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('REFUNDED');
    expect(await t.provider.getUtxosForLockingBytecode(created.contractLockingBytecode)).toHaveLength(0);
  });

  it('marks never-funded envelopes EXPIRED', async () => {
    const res = await t.http().post('/envelopes').send(createBody({ expiry: now() + 1 }));
    await sleep(1_200);
    await tick();
    expect((await t.db.envelope.findUniqueOrThrow({ where: { id: res.body.id } })).status).toBe('EXPIRED');
  });
});

describe('cleanup and reconciliation', () => {
  it('releases lapsed holds and reservations', async () => {
    const env = await fundedEnvelope(t);
    await t.http().post(`/envelopes/${env.id}/holds`).send({});
    const a = (await claimReq(t, env.id, { recipientAddress: addressOf('lapsed') })).body as ClaimApproval;
    await t.db.share.updateMany({ where: { envelopeId: env.id }, data: { reservedUntil: new Date(Date.now() - 1000) } });
    const s = await tick();
    expect(s.released).toEqual({ holds: 1, reservations: 1 });
    expect((await t.db.claim.findUniqueOrThrow({ where: { id: a.claimId } })).status).toBe('EXPIRED');
    expect(await t.db.share.count({ where: { envelopeId: env.id, status: 'AVAILABLE' } })).toBe(3);
  });

  it('records a claim that was broadcast outside the API', async () => {
    const env = await fundedEnvelope(t);
    const a = (await claimReq(t, env.id, { recipientAddress: addressOf('direct') })).body as ClaimApproval;
    const { hex } = buildClaimTx({ provider: t.provider, constructorArgs: a.constructorArgs, share: a.share, recipientLockingBytecode: a.recipientLockingBytecode, linkPrivateKey: linkPriv, gateSig: a.gateSig });
    const txid = await t.provider.sendRawTransaction(hex); // straight to the network

    const s = await tick();
    expect(s.reconciled).toBe(1);
    const claim = await t.db.claim.findUniqueOrThrow({ where: { id: a.claimId }, include: { share: true } });
    expect([claim.status, claim.claimTxid, claim.share?.status]).toEqual(['BROADCAST', txid, 'CLAIMED']);
    expect(await t.db.event.count({ where: { envelopeId: env.id, type: 'claimed' } })).toBe(1);
  });

  it('marks claims CONFIRMED once mined', async () => {
    const env = await fundedEnvelope(t);
    const { approval } = await claimAndBroadcast(env.id, 'miner');
    expect((await tick()).confirmed).toBe(0);
    chain.mineAll();
    expect((await tick()).confirmed).toBe(1);
    expect((await t.db.claim.findUniqueOrThrow({ where: { id: approval.claimId } })).status).toBe('CONFIRMED');
  });
});

describe('activation watcher and farm flags', () => {
  it('coins moved → activated; two claimers sweeping to one address → COMMON_SWEEP; idle 7 days → NEVER_USED', async () => {
    const env = await fundedEnvelope(t);
    const farm = p2pkh(pub(key('farm')));
    const alice = await claimAndBroadcast(env.id, 'alice');
    const bob = await claimAndBroadcast(env.id, 'bob');
    const carol = await claimAndBroadcast(env.id, 'carol');
    await spendClaim('alice', alice.txid, alice.amount, farm);
    await spendClaim('bob', bob.txid, bob.amount, farm);
    await t.db.claim.update({ where: { id: carol.approval.claimId }, data: { createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) } });

    const s = await tick();
    expect(s.activation).toEqual({ checked: 3, activated: 2, notActivated: 1 });
    const rows = await t.db.claim.findMany({ where: { envelopeId: env.id }, orderBy: { createdAt: 'desc' } });
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(alice.approval.claimId)).toMatchObject({ activatedWithin7d: true, sweptTo: [binToHex(farm)], suspectedFarm: true, farmReasons: ['COMMON_SWEEP'] });
    expect(by(bob.approval.claimId).farmReasons).toEqual(['COMMON_SWEEP']);
    expect(by(carol.approval.claimId)).toMatchObject({ activatedWithin7d: false, farmReasons: ['NEVER_USED'] });
  });

  it('farmFlags: SAME_FINGERPRINT and IP_BURST (≥3 claims in 60 s from one IP)', () => {
    const base = { recipientLockingBytecode: '', sweptTo: [], activatedWithin7d: null, walletFingerprint: null, ipHash: null };
    const at = (s: number) => new Date(1_800_000_000_000 + s * 1000);
    const flags = farmFlags([
      { ...base, id: 'a', createdAt: at(0), ipHash: 'ip1', recipientLockingBytecode: 'a' },
      { ...base, id: 'b', createdAt: at(30), ipHash: 'ip1', recipientLockingBytecode: 'b' },
      { ...base, id: 'c', createdAt: at(59), ipHash: 'ip1', recipientLockingBytecode: 'c', walletFingerprint: 'fp' },
      { ...base, id: 'd', createdAt: at(200), ipHash: 'ip1', recipientLockingBytecode: 'd', walletFingerprint: 'fp' },
      { ...base, id: 'e', createdAt: at(10), ipHash: 'ip2', recipientLockingBytecode: 'e' },
    ]);
    expect(flags.get('a')).toEqual(['IP_BURST']);
    expect(flags.get('c')).toEqual(['SAME_FINGERPRINT', 'IP_BURST']);
    expect(flags.get('d')).toEqual(['SAME_FINGERPRINT']);
    expect(flags.get('e')).toEqual([]);
  });
});

describe('pass it on', () => {
  it('builds a 3-generation tree, emits passedOn, and counts passing on as activation', async () => {
    const root = await fundedEnvelope(t, { shareCount: 2, totalSats: 20_000 });
    const alice = await claimAndBroadcast(root.id, 'alice');
    const child = await fundedEnvelope(t, { shareCount: 2, totalSats: 8_000, parentEnvelopeId: root.id }, 'alice');
    const dave = await claimAndBroadcast(child.id, 'dave');
    const grand = await fundedEnvelope(t, { shareCount: 2, totalSats: 4_000, parentEnvelopeId: child.id }, 'dave');

    const ev = await t.db.event.findFirstOrThrow({ where: { envelopeId: root.id, type: 'passedOn' } });
    expect(ev.payload).toMatchObject({ childId: child.id, shareCount: 2, sats: 8_000 });

    const tree = (await t.http().get(`/envelopes/${grand.id}/tree`)).body as TreeResponse;
    expect(tree).toMatchObject({ rootId: root.id, focusId: grand.id, generations: 3, totalReach: 2, passOnEnvelopes: 2, viralCoefficient: 1 });
    expect(tree.nodes.map((n) => [n.id, n.generation, n.claims])).toEqual([
      [root.id, 0, 1],
      [child.id, 1, 1],
      [grand.id, 2, 0],
    ]);

    await tick();
    for (const c of [alice, dave]) {
      expect((await t.db.claim.findUniqueOrThrow({ where: { id: c.approval.claimId } })).activatedWithin7d).toBe(true);
    }
  });
});

describe('SSE /envelopes/:id/events', () => {
  const sse = (path: string, headers: Record<string, string> = {}) =>
    t
      .http()
      .get(path)
      .set(headers)
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });

  it('streams live claims and resumes from Last-Event-ID', async () => {
    const env = await fundedEnvelope(t, { withStamps: true });
    const first = await claimAndBroadcast(env.id, 'early');

    const streaming = sse(`/envelopes/${env.id}/events?maxSeconds=3`);
    await sleep(500);
    const live = await claimAndBroadcast(env.id, 'live');
    const r = await streaming;
    expect(r.headers['content-type']).toMatch(/text\/event-stream/);
    const text = r.body as string;
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => m[1]!);
    expect(text).toContain('event: claimed');
    expect(text).toContain(first.txid); // replayed recent event
    expect(text).toContain(live.txid); // live event
    const payload = JSON.parse(text.split('\n').find((l) => l.startsWith('data:') && l.includes(live.txid))!.slice(5));
    expect(payload).toMatchObject({ isNewWallet: true, sharesLeft: 1, sats: Number(live.amount) });

    const resumed = (await sse(`/envelopes/${env.id}/events?maxSeconds=1`, { 'last-event-id': ids[0]! })).body as string;
    expect(resumed).not.toContain(first.txid);
    expect(resumed).toContain(live.txid);
  });
});
