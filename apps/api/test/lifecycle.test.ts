// Phase 5: keeper (refunds, cleanup, reconciliation, activation, farm flags), SSE, pass-it-on tree.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignatureTemplate, TransactionBuilder, type MockNetworkProvider } from 'cashscript';
import { binToHex, decodeTransaction, hash256, hexToBin, sha256 } from '@bitauth/libauth';
import { buildClaimTx, buildRefundTx, hongbaoContract } from '@hongbao/contract';
import type { ClaimApproval, CreateEnvelopeResponse, TreeResponse } from '@hongbao/shared';
import { farmFlags } from '../src/keeper/farm-flags.js';
import { EventsService } from '../src/events/events.service.js';
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
  SENDER_ADDRESS,
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

  it('review-2 P1-8: GET (the daily Vercel Cron backstop) is registered too, with the same auth', async () => {
    expect((await t.http().get('/internal/keeper/tick')).status).toBe(401); // was 404: route missing
    const r = await t.http().get('/internal/keeper/tick').set('authorization', `Bearer ${KEEPER_TOKEN}`);
    expect([r.status, r.body.ran]).toEqual([200, true]);
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
    // +2 s, not +1: the API's minimum is 1 s, so a clock tick between test and server would reject +1.
    const res = await t.http().post('/envelopes').send(createBody({ expiry: now() + 2 }));
    expect(res.status).toBe(201);
    await sleep(2_200);
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
  /** The claimer's claimed coin (claimTxid:0), to fund a re-gift from. */
  const claimedCoin = async (who: string, claimTxid: string) =>
    (await t.provider.getUtxosForLockingBytecode(binToHex(p2pkh(pub(key(who)))))).find((u) => u.txid === claimTxid)!;

  it('builds a 3-generation tree from re-gifts of claimed coins, emits passedOn, counts as activation', async () => {
    const root = await fundedEnvelope(t, { shareCount: 2, totalSats: 40_000 });
    const alice = await claimAndBroadcast(root.id, 'alice');
    const child = await fundedEnvelope(t, { shareCount: 2, totalSats: 16_000, parentEnvelopeId: root.id }, 'alice', await claimedCoin('alice', alice.txid));
    const dave = await claimAndBroadcast(child.id, 'dave');
    const grand = await fundedEnvelope(t, { shareCount: 2, totalSats: 3_000, parentEnvelopeId: child.id }, 'dave', await claimedCoin('dave', dave.txid));

    const ev = await t.db.event.findFirstOrThrow({ where: { envelopeId: root.id, type: 'passedOn' } });
    expect(ev.payload).toMatchObject({ childId: child.id, shareCount: 2, sats: 16_000 });

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

  it('review #2: an unfunded "child" or one paid from other coins neither activates nor counts as reach', async () => {
    const root = await fundedEnvelope(t, { shareCount: 3, totalSats: 30_000 });
    const bob = await claimAndBroadcast(root.id, 'bob');
    const carol = await claimAndBroadcast(root.id, 'carol');
    // Carol: a free POST /envelopes naming the sponsor's envelope as parent, never funded.
    const fake = await t.http().post('/envelopes').send(createBody({ senderAddress: addressOf('carol', false), parentEnvelopeId: root.id, expiry: now() + 2 }));
    expect(fake.status).toBe(201);
    // Bob: a real child, but funded from unrelated coins — not a re-gift of what he caught.
    await fundedEnvelope(t, { shareCount: 2, totalSats: 8_000, parentEnvelopeId: root.id }, 'bob');
    await sleep(2_200);
    await tick(); // also marks carol's unfunded envelope EXPIRED

    const tree = (await t.http().get(`/envelopes/${root.id}/tree`)).body as TreeResponse;
    expect(tree.nodes.map((n) => n.id)).not.toContain(fake.body.id);
    for (const c of [bob, carol]) {
      expect((await t.db.claim.findUniqueOrThrow({ where: { id: c.approval.claimId } })).activatedWithin7d).toBeNull();
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

  it('review-2 P1-9: opening streams is rate-limited per IP', async () => {
    const env = await fundedEnvelope(t);
    const ip = { 'x-forwarded-for': '10.30.0.1' };
    const opens = await Promise.all(Array.from({ length: 31 }, () => sse(`/envelopes/${env.id}/events?maxSeconds=1`, ip)));
    expect(opens.filter((r) => r.status === 200)).toHaveLength(30);
    expect(opens.filter((r) => r.status === 429)).toHaveLength(1);
    expect((await sse(`/envelopes/${env.id}/events?maxSeconds=1`, { 'x-forwarded-for': '10.30.0.2' })).status).toBe(200);
  });

  it('review-2 P1-9: a DB error mid-stream ends the stream cleanly', async () => {
    const env = await fundedEnvelope(t);
    const events = t.app.get(EventsService);
    const after = events.after.bind(events);
    events.after = async () => Promise.reject(new Error('connection terminated'));
    try {
      const r = await sse(`/envelopes/${env.id}/events?maxSeconds=5`, { 'x-forwarded-for': '10.30.0.3' });
      expect(r.status).toBe(200);
      expect(r.body).toContain('retry: 1000');
    } finally {
      events.after = after;
    }
    expect((await t.http().get('/health')).status).toBe(200); // process still fine
  });
});

describe('review fixes: keeper robustness', () => {
  const contractOf = (env: CreateEnvelopeResponse) =>
    hongbaoContract(
      {
        linkPk: hexToBin(env.constructorArgs.linkPk),
        gatePk: hexToBin(env.constructorArgs.gatePk),
        refundLockingBytecode: hexToBin(env.constructorArgs.refundLockingBytecode),
        expiry: env.constructorArgs.expiry,
      },
      t.provider,
    );
  const txidOf = (hex: string) => binToHex(hash256(hexToBin(hex)).reverse());

  it('#1: a dust coin, a broken envelope and an externally refunded one do not block the other refunds', async () => {
    const dusty = await fundedEnvelope(t, { expiry: now() + 2 });
    t.provider.addUtxo(dusty.contractLockingBytecode, { txid: 'aa'.repeat(32), vout: 0, satoshis: 600n }); // griefing coin
    const broken = await fundedEnvelope(t, { expiry: now() + 2 });
    const external = await fundedEnvelope(t, { expiry: now() + 2 });
    const healthy = await fundedEnvelope(t, { expiry: now() + 2 });
    await sleep(2_200);
    // "broken": DB params no longer match the on-chain contract, so building its refund throws.
    await t.db.envelope.update({ where: { id: broken.id }, data: { maxFee: 1 } });
    // "external": someone else already broadcast its refund.
    const ext = contractOf(external);
    const { hex } = buildRefundTx({
      contract: ext,
      utxos: await t.provider.getUtxosForLockingBytecode(external.contractLockingBytecode),
      refundLockingBytecode: external.constructorArgs.refundLockingBytecode,
      expiry: external.constructorArgs.expiry,
      maxFee: 1000n,
    });
    await t.provider.sendRawTransaction(hex);

    const s = await tick();
    expect(s.refunds!.map((r) => r.envelopeId).sort()).toEqual([dusty.id, healthy.id].sort());
    expect(s.dustSkipped).toBe(1);
    expect(s.errors.some((e) => e.includes(broken.id))).toBe(true);
    // The externally refunded one was reconciled instead of occupying a slot forever.
    expect(await t.db.share.count({ where: { envelopeId: external.id, status: 'REFUNDED', spendTxid: txidOf(hex) } })).toBe(3);
    expect((await t.provider.getUtxosForLockingBytecode(dusty.contractLockingBytecode)).map((u) => u.satoshis)).toEqual([600n]);
  });

  it('#11: a coin sent to a fully claimed contract is refunded after expiry', async () => {
    const env = await fundedEnvelope(t, { shareCount: 1, totalSats: 10_000, expiry: now() + 2 });
    await claimAndBroadcast(env.id, 'only');
    t.provider.addUtxo(env.contractLockingBytecode, { txid: 'bb'.repeat(32), vout: 1, satoshis: 7_000n }); // sender funded twice
    await sleep(2_200);
    const s = await tick();
    expect(s.refunds).toEqual([expect.objectContaining({ envelopeId: env.id, shares: 1 })]);
  });

  it('#8: the same refund txid is recorded once even if two ticks broadcast it', async () => {
    const env = await fundedEnvelope(t, { expiry: now() + 2 });
    await sleep(2_200);
    const { hex } = buildRefundTx({
      contract: contractOf(env),
      utxos: await t.provider.getUtxosForLockingBytecode(env.contractLockingBytecode),
      refundLockingBytecode: env.constructorArgs.refundLockingBytecode,
      expiry: env.constructorArgs.expiry,
      maxFee: 1000n,
    });
    // An earlier (racing) tick already recorded this exact refund.
    await t.db.event.create({ data: { envelopeId: env.id, type: 'refunded', payload: { txid: txidOf(hex), shares: 3, sats: 1 } } });
    const s = await tick();
    expect(s.refunds).toEqual([]);
    expect(await t.db.event.count({ where: { envelopeId: env.id, type: 'refunded' } })).toBe(1);
    expect((await t.db.envelope.findUniqueOrThrow({ where: { id: env.id } })).refundedSats).toBe(0n);
  });

  it("#8: a tick never releases someone else's lease", async () => {
    const theirs = `${new Date(Date.now() + 60_000).toISOString()}#other-instance`;
    await t.db.setting.upsert({ where: { key: 'keeper.lease' }, create: { key: 'keeper.lease', value: theirs }, update: { value: theirs } });
    expect((await tick()).ran).toBe(false);
    expect((await t.db.setting.findUniqueOrThrow({ where: { key: 'keeper.lease' } })).value).toBe(theirs);
  });

  it('#10: reconcile records a stale approval that won the race and frees the other claimer', async () => {
    const env = await fundedEnvelope(t, { shareCount: 2, totalSats: 20_000 });
    const x = (await claimReq(t, env.id, { recipientAddress: addressOf('x') })).body as ClaimApproval;
    await t.db.share.updateMany({ where: { envelopeId: env.id }, data: { reservedUntil: new Date(Date.now() - 1000) } });
    const y = (await claimReq(t, env.id, { recipientAddress: addressOf('y') }, '10.6.6.6')).body as ClaimApproval;
    expect(y.share).toEqual(x.share);
    const { hex } = buildClaimTx({ provider: t.provider, constructorArgs: x.constructorArgs, share: x.share, recipientLockingBytecode: x.recipientLockingBytecode, linkPrivateKey: linkPriv, gateSig: x.gateSig });
    await t.provider.sendRawTransaction(hex); // X's old approval wins on-chain

    const s = await tick();
    expect(s.errors).toEqual([]);
    expect((await t.db.claim.findUniqueOrThrow({ where: { id: x.claimId } })).status).toBe('BROADCAST');
    expect(await t.db.claim.findUniqueOrThrow({ where: { id: y.claimId } })).toMatchObject({ status: 'EXPIRED', shareId: null });
    // Y's old approval for that share stays valid on-chain while X's tx is unmined (it could still be
    // dropped), so Y must wait for X's confirmation before getting a second share (review-2 P1-13).
    const early = await claimReq(t, env.id, { recipientAddress: addressOf('y') }, '10.6.6.6');
    expect([early.status, early.body.error.code]).toEqual([409, 'ALREADY_CLAIMED']);
    await t.db.claim.update({ where: { id: x.claimId }, data: { status: 'CONFIRMED' } });
    const retry = (await claimReq(t, env.id, { recipientAddress: addressOf('y') }, '10.6.6.6')).body as ClaimApproval;
    expect(retry.share.index).not.toBe(x.share.index); // Y gets the other, unspent share
  });

  it('#13: an envelope whose funding tx vanished is marked FAILED and refuses claims', async () => {
    const env = await fundedEnvelope(t);
    await t.db.envelope.update({ where: { id: env.id }, data: { fundedAt: new Date(Date.now() - 31 * 60_000) } });
    const getRaw = t.provider.getRawTransaction.bind(t.provider);
    const getUtxos = t.provider.getUtxosForLockingBytecode.bind(t.provider);
    t.provider.getRawTransaction = async (txid: string) => (txid === env.fundingTxid ? (undefined as never) : getRaw(txid));
    t.provider.getUtxosForLockingBytecode = async (lb) => (lb === env.contractLockingBytecode ? [] : getUtxos(lb));
    try {
      const s = await tick();
      expect(s.failedEnvelopes).toBe(1);
      expect((await t.db.envelope.findUniqueOrThrow({ where: { id: env.id } })).status).toBe('FAILED');
      expect((await claimReq(t, env.id, { recipientAddress: addressOf('z') })).body.error.code).toBe('NOT_FUNDED');
    } finally {
      t.provider.getRawTransaction = getRaw;
      t.provider.getUtxosForLockingBytecode = getUtxos;
    }
  });

  it('#15: a claim tx dropped by the network is expired and its share freed', async () => {
    const env = await fundedEnvelope(t, { shareCount: 1, totalSats: 10_000 });
    const c = await claimAndBroadcast(env.id, 'unlucky');
    await t.db.claim.update({ where: { id: c.approval.claimId }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    const getRaw = t.provider.getRawTransaction.bind(t.provider);
    const hist = (t.provider as unknown as { history: (lb: string) => Promise<Hist> }).history;
    t.provider.getRawTransaction = async (txid: string) => (txid === c.txid ? (undefined as never) : getRaw(txid));
    Object.assign(t.provider, { history: async (lb: string) => (await hist(lb)).filter((h) => h.tx_hash !== c.txid) });
    try {
      const s = await tick();
      expect(s.dropped).toBe(1);
      expect((await t.db.claim.findUniqueOrThrow({ where: { id: c.approval.claimId } })).status).toBe('EXPIRED');
      expect((await t.db.share.findFirstOrThrow({ where: { envelopeId: env.id } })).status).toBe('AVAILABLE');
    } finally {
      t.provider.getRawTransaction = getRaw;
      Object.assign(t.provider, { history: hist });
    }
  });
});

describe('review 2: refunds and envelope status', () => {
  const txidOf = (hex: string) => binToHex(hash256(hexToBin(hex)).reverse());
  const contractOf = (env: CreateEnvelopeResponse) =>
    hongbaoContract(
      {
        linkPk: hexToBin(env.constructorArgs.linkPk),
        gatePk: hexToBin(env.constructorArgs.gatePk),
        refundLockingBytecode: hexToBin(env.constructorArgs.refundLockingBytecode),
        expiry: env.constructorArgs.expiry,
      },
      t.provider,
    );

  it('P1-1: refunds no-stamp shares at the 1,500-sat minimum, and the envelope ends REFUNDED', async () => {
    const env = await fundedEnvelope(t, { shareCount: 3, totalSats: 4_500, expiry: now() + 2 });
    await sleep(2_200);
    const s = await tick();
    expect(s.refunds).toEqual([expect.objectContaining({ envelopeId: env.id, shares: 3 })]);
    expect(s.dustSkipped).toBe(0);
    expect(await t.provider.getUtxosForLockingBytecode(env.contractLockingBytecode)).toEqual([]);
    expect((await t.db.envelope.findUniqueOrThrow({ where: { id: env.id } })).status).toBe('REFUNDED');
    expect(await t.db.share.count({ where: { envelopeId: env.id, status: 'REFUNDED' } })).toBe(3);
  });

  it('P1-2: an envelope refunded by someone else before the keeper ends REFUNDED, not EXPIRED forever', async () => {
    const env = await fundedEnvelope(t, { expiry: now() + 2 });
    await claimAndBroadcast(env.id, 'early-bird');
    await sleep(2_200);
    const { hex } = buildRefundTx({
      contract: contractOf(env),
      utxos: await t.provider.getUtxosForLockingBytecode(env.contractLockingBytecode),
      refundLockingBytecode: env.constructorArgs.refundLockingBytecode,
      expiry: env.constructorArgs.expiry,
      maxFee: 1000n,
    });
    await t.provider.sendRawTransaction(hex); // keyless: anyone may broadcast it
    const s = await tick();
    expect(s.refunds).toEqual([]);
    const after = await t.db.envelope.findUniqueOrThrow({ where: { id: env.id } });
    expect(after.status).toBe('REFUNDED');
    expect(await t.db.share.count({ where: { envelopeId: env.id, status: 'REFUNDED', spendTxid: txidOf(hex) } })).toBe(2);
  });

  it('P1-2/P1-12: a last share claimed outside the API ends the envelope EXHAUSTED with an `exhausted` event', async () => {
    const env = await fundedEnvelope(t, { shareCount: 2, totalSats: 10_000 });
    await claimAndBroadcast(env.id, 'via-api');
    // The second claimer gets an approval but broadcasts the claim tx themselves.
    const a = (await claimReq(t, env.id, { recipientAddress: addressOf('direct') }, '10.9.9.9')).body as ClaimApproval;
    const { hex } = buildClaimTx({
      provider: t.provider,
      constructorArgs: a.constructorArgs,
      share: a.share,
      recipientLockingBytecode: a.recipientLockingBytecode,
      linkPrivateKey: linkPriv,
      gateSig: a.gateSig,
    });
    await t.provider.sendRawTransaction(hex);
    await tick();
    expect((await t.db.envelope.findUniqueOrThrow({ where: { id: env.id } })).status).toBe('EXHAUSTED');
    const events = await t.db.event.findMany({ where: { envelopeId: env.id }, orderBy: { id: 'asc' } });
    const claimed = events.filter((e) => e.type === 'claimed').map((e) => e.payload as Record<string, unknown>);
    expect(claimed).toHaveLength(2);
    // Same payload shape whether the API or the keeper recorded the claim.
    for (const p of claimed) expect(Object.keys(p)).toEqual(expect.arrayContaining(['usd', 'luckiest', 'sharesLeft', 'sats', 'txid']));
    expect(claimed[1]!.sharesLeft).toBe(0);
    expect(events.filter((e) => e.type === 'exhausted')).toHaveLength(1);
  });

  it('P1-11: a sender claiming their own share directly is recorded as a claim, not a refund', async () => {
    const env = await fundedEnvelope(t, { shareCount: 2, totalSats: 10_000 });
    const a = (await claimReq(t, env.id, { recipientAddress: SENDER_ADDRESS }, '10.9.9.8')).body as ClaimApproval;
    const { hex } = buildClaimTx({
      provider: t.provider,
      constructorArgs: a.constructorArgs,
      share: a.share,
      recipientLockingBytecode: a.recipientLockingBytecode,
      linkPrivateKey: linkPriv,
      gateSig: a.gateSig,
    });
    await t.provider.sendRawTransaction(hex);
    await tick();
    const share = await t.db.share.findFirstOrThrow({ where: { envelopeId: env.id, spendTxid: txidOf(hex) } });
    expect(share.status).toBe('CLAIMED');
    expect((await t.db.claim.findUniqueOrThrow({ where: { id: a.claimId } })).status).toBe('BROADCAST');
  });
});

describe('review 2: refund queue', () => {
  it('P1-7: an envelope that waited for median-time-past is refunded on the next tick, not queued behind finished ones', async () => {
    const env = await fundedEnvelope(t, { expiry: now() + 2 });
    // 15 finished (never-funded) envelopes that were checked a while ago.
    for (let i = 0; i < 15; i++) {
      const r = await t.http().post('/envelopes').set('x-forwarded-for', `10.20.0.${i}`).send(createBody({ expiry: now() + 2 }));
      expect(r.status).toBe(201);
    }
    await sleep(2_200);
    await t.db.envelope.updateMany({ where: { NOT: { id: env.id } }, data: { status: 'EXPIRED', refundCheckedAt: new Date(Date.now() - 10 * 60_000) } });
    mtp = now() - 60; // the network won't accept refunds yet
    const s1 = await tick();
    expect([s1.refunds, s1.refundsWaiting]).toEqual([[], 1]);
    mtp = now() + 3600; // now it will
    const s2 = await tick();
    expect(s2.refunds).toEqual([expect.objectContaining({ envelopeId: env.id, shares: 3 })]);
  });

  it('P2-3: coins of a FAILED envelope whose funding reappeared are still refunded (hourly sweep)', async () => {
    const env = await fundedEnvelope(t, { expiry: now() + 2 });
    await sleep(2_200);
    await t.db.envelope.update({ where: { id: env.id }, data: { status: 'FAILED', refundCheckedAt: new Date(Date.now() - 2 * 3600_000) } });
    const s = await tick();
    expect(s.refunds).toEqual([expect.objectContaining({ envelopeId: env.id, shares: 3 })]);
    expect(await t.provider.getUtxosForLockingBytecode(env.contractLockingBytecode)).toEqual([]);
  });
});
