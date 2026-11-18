// Gate tests: every claim here is broadcast as a real claim tx that the mock network validates
// against Hongbao.cash — so a passing test means the gate's signature really unlocks the share.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { binToHex } from '@bitauth/libauth';
import type { ClaimApproval } from '@hongbao/shared';
import { addressOf, broadcastReq, claimReq, fundedEnvelope, key, makeApp, p2pkh, pub, resetDb } from './helpers.js';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => (t = await makeApp()));
afterAll(async () => t.app.close());
beforeEach(async () => resetDb(t.db));

describe('claim → broadcast (happy path)', () => {
  it('approves, signs, and the claim tx unlocks the share on-chain (seal-bearing)', async () => {
    const env = await fundedEnvelope(t, { withSeals: true });
    const r = await claimReq(t, env.id, { recipientAddress: addressOf('alice') });
    expect(r.status).toBe(201);
    const a = r.body as ClaimApproval;
    expect(a.gateSig).toMatch(/^[0-9a-f]{128}$/);
    expect(a.share.tokenCategory).toBe(env.fundingTemplate[1]!.token!.category);
    expect(a.isNewWallet).toBe(true);
    expect(new Date(a.reservedUntil).getTime()).toBeGreaterThan(Date.now() + 100_000);

    const b = await broadcastReq(t, a);
    expect(b.status).toBe(200);
    expect(b.body.amountSats).toBeGreaterThan(9_000);
    expect(b.body.amountUsd).toBe(0.02);
    expect(b.body.seal).toMatchObject({ commitment: a.share.nftCommitment });
    expect(b.body.seal.alt).toMatch(/Hongbao Seal/);

    // Seal on a dust output, the rest as plain BCH (wallets only count token-free outputs as balance).
    const got = await t.provider.getUtxosForLockingBytecode(a.recipientLockingBytecode);
    expect(got).toHaveLength(2);
    expect(got.find((u) => u.token)?.token?.nft?.commitment).toBe(a.share.nftCommitment);
    expect(got.reduce((sum, u) => sum + u.satoshis, 0n)).toBe(BigInt(b.body.amountSats));
    expect(got.find((u) => !u.token)!.satoshis).toBeGreaterThan(8_000n);
    const share = await t.db.share.findFirstOrThrow({
      where: { outpointTxid: a.share.outpointTxid, outpointIndex: a.share.outpointIndex },
    });
    expect(share.status).toBe('CLAIMED');

    const view = await t.http().get(`/envelopes/${env.id}`);
    expect(view.body.shares).toEqual({ total: 3, claimed: 1, left: 2 });
    expect(view.body.recentClaims[0]).toMatchObject({ isNewWallet: true });
    expect(view.body.recentClaims[0].address).toMatch(/^bchtest:z\w{3}…\w{4}$/);
  });

  it('flags wallets with prior history as not new', async () => {
    const env = await fundedEnvelope(t);
    t.provider.addUtxo(binToHex(p2pkh(pub(key('old-timer')))), { txid: 'cd'.repeat(32), vout: 0, satoshis: 5_000n });
    const r = await claimReq(t, env.id, { recipientAddress: addressOf('old-timer', false) });
    expect(r.body.isNewWallet).toBe(false);
  });
});

describe('parallel claims and exhaustion', () => {
  it('3 parallel claims on a 3-share envelope get 3 different shares; the 4th is too slow', async () => {
    const env = await fundedEnvelope(t);
    const rs = await Promise.all(
      ['a', 'b', 'c'].map((n, i) => claimReq(t, env.id, { recipientAddress: addressOf(n) }, `198.51.100.${i}`)),
    );
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201]);
    const outpoints = new Set(rs.map((r) => `${r.body.share.outpointTxid}:${r.body.share.outpointIndex}`));
    expect(outpoints.size).toBe(3);

    const bs = await Promise.all(rs.map((r) => broadcastReq(t, r.body)));
    expect(bs.map((b) => b.status)).toEqual([200, 200, 200]);

    const fourth = await claimReq(t, env.id, { recipientAddress: addressOf('d') });
    expect(fourth.status).toBe(410);
    expect(fourth.body.error).toEqual({ code: 'ENVELOPE_EMPTY', message: 'Too slow! All the red envelopes have been grabbed.' });
    expect((await t.db.envelope.findUniqueOrThrow({ where: { id: env.id } })).status).toBe('EXHAUSTED');
    expect((await t.http().get(`/envelopes/${env.id}`)).body.status).toBe('EXHAUSTED');
    // Someone who already got a share is told so, not "too slow".
    const back = await claimReq(t, env.id, { recipientAddress: addressOf('a', false) });
    expect([back.status, back.body.error.code]).toEqual([409, 'ALREADY_CLAIMED']);
  });

  it('8 simultaneous claimers on 3 shares: exactly 3 approvals, never a shared share', async () => {
    const env = await fundedEnvelope(t);
    const rs = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claimReq(t, env.id, { recipientAddress: addressOf(`racer${i}`) }, `192.0.2.${i}`)),
    );
    const ok = rs.filter((r) => r.status === 201);
    expect(ok).toHaveLength(3);
    expect(rs.filter((r) => r.status === 410)).toHaveLength(5);
    expect(new Set(ok.map((r) => r.body.share.index)).size).toBe(3);
  });
});

describe('one claim per recipient / fingerprint', () => {
  it('retrying before broadcast returns the same approval; after broadcast it is ALREADY_CLAIMED', async () => {
    const env = await fundedEnvelope(t);
    const first = await claimReq(t, env.id, { recipientAddress: addressOf('bob') });
    const retry = await claimReq(t, env.id, { recipientAddress: addressOf('bob') });
    expect(retry.body.claimId).toBe(first.body.claimId);
    expect(retry.body.share).toEqual(first.body.share);

    await broadcastReq(t, first.body);
    const again = await claimReq(t, env.id, { recipientAddress: addressOf('bob') });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_CLAIMED');
    // The plain (q…) form of the same key is the same wallet.
    const plain = await claimReq(t, env.id, { recipientAddress: addressOf('bob', false) });
    expect(plain.body.error.code).toBe('ALREADY_CLAIMED');
  });

  it('same wallet fingerprint with a different address is refused', async () => {
    const env = await fundedEnvelope(t);
    const fp = 'ab'.repeat(16);
    expect((await claimReq(t, env.id, { recipientAddress: addressOf('carol'), walletFingerprint: fp })).status).toBe(201);
    const r = await claimReq(t, env.id, { recipientAddress: addressOf('carol2'), walletFingerprint: fp });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ALREADY_CLAIMED');
  });

  it('a recipient racing itself in parallel gets one claim', async () => {
    const env = await fundedEnvelope(t);
    const rs = await Promise.all(Array.from({ length: 4 }, () => claimReq(t, env.id, { recipientAddress: addressOf('dup') })));
    const ids = new Set(rs.filter((r) => r.status === 201).map((r) => r.body.claimId));
    expect(ids.size).toBe(1);
    expect(await t.db.claim.count({ where: { envelopeId: env.id } })).toBe(1);
    expect(await t.db.share.count({ where: { envelopeId: env.id, status: 'RESERVED' } })).toBe(1);
  });
});

describe('hold my share', () => {
  it('hold → claim with the token gets the held share; the token is single-use', async () => {
    const env = await fundedEnvelope(t, { shareCount: 2, totalSats: 20_000 });
    const h = await t.http().post(`/envelopes/${env.id}/holds`).send({});
    expect(h.status).toBe(201);
    expect(new Date(h.body.heldUntil).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    const held = await t.db.share.findFirstOrThrow({ where: { holdToken: h.body.holdToken } });
    expect(held.status).toBe('HELD');

    const c = await claimReq(t, env.id, { recipientAddress: addressOf('newbie'), holdToken: h.body.holdToken });
    expect(c.status).toBe(201);
    expect(c.body.share.index).toBe(held.index);
    expect((await broadcastReq(t, c.body)).status).toBe(200);

    const reuse = await claimReq(t, env.id, { recipientAddress: addressOf('newbie2'), holdToken: h.body.holdToken });
    expect(reuse.status).toBe(410);
    expect(reuse.body.error.code).toBe('HOLD_EXPIRED');
  });

  it('a held share is not given to anyone else; an expired hold is', async () => {
    const env = await fundedEnvelope(t, { shareCount: 1, totalSats: 10_000 });
    const h = await t.http().post(`/envelopes/${env.id}/holds`).send({ fingerprint: 'cd'.repeat(16) });
    expect((await claimReq(t, env.id, { recipientAddress: addressOf('other') })).body.error.code).toBe('ENVELOPE_EMPTY');
    // Same device asking again gets the same hold.
    const again = await t.http().post(`/envelopes/${env.id}/holds`).send({ fingerprint: 'cd'.repeat(16) });
    expect(again.body.holdToken).toBe(h.body.holdToken);

    await t.db.share.updateMany({ where: { holdToken: h.body.holdToken }, data: { reservedUntil: new Date(Date.now() - 1000) } });
    const late = await claimReq(t, env.id, { recipientAddress: addressOf('late'), holdToken: h.body.holdToken });
    expect(late.body.error.code).toBe('HOLD_EXPIRED');
    expect((await claimReq(t, env.id, { recipientAddress: addressOf('other') })).status).toBe(201);
  });
});

describe('quiz', () => {
  it('wrong answers count down, the right one (normalised) unlocks, 5 wrong → rate limited', async () => {
    const env = await fundedEnvelope(t, {
      mode: 'QUIZ',
      quiz: { question: 'Which chain is this?', answers: ['Bitcoin Cash', 'BCH'] },
    });
    const w = await claimReq(t, env.id, { recipientAddress: addressOf('q1'), answer: 'ethereum' }, '10.0.0.1');
    expect(w.status).toBe(403);
    expect(w.body.error).toMatchObject({ code: 'WRONG_ANSWER', message: 'Not quite — try again.', attemptsLeft: 4 });
    expect((await claimReq(t, env.id, { recipientAddress: addressOf('q1') }, '10.0.0.1')).body.error.attemptsLeft).toBe(3);

    const ok = await claimReq(t, env.id, { recipientAddress: addressOf('q1'), answer: '  bitcoin   CASH ' }, '10.0.0.1');
    expect(ok.status).toBe(201);

    for (let i = 0; i < 5; i++) await claimReq(t, env.id, { recipientAddress: addressOf('q2'), answer: 'nope' }, '10.0.0.2');
    const limited = await claimReq(t, env.id, { recipientAddress: addressOf('q2'), answer: 'BCH' }, '10.0.0.2');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('a hold needs the right answer too (a wrong one must not tie up a share)', async () => {
    const env = await fundedEnvelope(t, { mode: 'QUIZ', quiz: { question: 'Which chain?', answers: ['Bitcoin Cash'] } });
    const hold = (body: object) => t.http().post(`/envelopes/${env.id}/holds`).set('x-forwarded-for', '10.0.0.9').send(body);
    const none = await hold({});
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('WRONG_ANSWER');
    const wrong = await hold({ answer: 'Dogecoin' });
    expect(wrong.body.error).toMatchObject({ code: 'WRONG_ANSWER', attemptsLeft: 3 });
    expect(await t.db.share.count({ where: { envelopeId: env.id, status: 'HELD' } })).toBe(0);
    const ok = await hold({ answer: ' bitcoin cash ' });
    expect(ok.status).toBe(201);
    expect(ok.body.holdToken).toBeTruthy();
  });
});

describe('refusals', () => {
  it('NOT_FUNDED before funding, ENVELOPE_EXPIRED after expiry', async () => {
    const pending = await t.http().post('/envelopes').send({
      senderAddress: 'bchtest:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwgw2cltjwn',
      linkPk: binToHex(pub(key('link'))),
      shareCount: 2,
      mode: 'EQUAL',
      totalSats: 10_000,
      expiry: Math.floor(Date.now() / 1000) + 1800,
      withSeals: false,
    });
    const r1 = await claimReq(t, pending.body.id, { recipientAddress: addressOf('x') });
    expect([r1.status, r1.body.error.code]).toEqual([409, 'NOT_FUNDED']);

    const env = await fundedEnvelope(t);
    await t.db.envelope.update({ where: { id: env.id }, data: { expiry: Math.floor(Date.now() / 1000) - 1 } });
    const r2 = await claimReq(t, env.id, { recipientAddress: addressOf('x') });
    expect([r2.status, r2.body.error.code]).toEqual([410, 'ENVELOPE_EXPIRED']);
  });

  it('rejects addresses for the wrong network', async () => {
    const env = await fundedEnvelope(t);
    const r = await claimReq(t, env.id, { recipientAddress: 'bitcoincash:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwg2cucf9f0' });
    expect(r.body.error.code).toBe('INVALID_REQUEST');
  });

  it('rate limits claim attempts per IP per envelope', async () => {
    const env = await fundedEnvelope(t, { shareCount: 1, totalSats: 10_000 });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await claimReq(t, env.id, { recipientAddress: addressOf(`spam${i}`) }, '10.9.9.9')).status);
    }
    expect(codes.slice(0, 10).every((c) => c !== 429)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('reservations and broadcast safety', () => {
  it('an abandoned reservation frees its share after 120 s; the API refuses to relay the old approval', async () => {
    // Note: the old approval itself stays valid on-chain — the keeper's reconcile step records it if
    // its holder broadcasts it elsewhere and wins the race (see lifecycle tests).
    const env = await fundedEnvelope(t, { shareCount: 1, totalSats: 10_000 });
    const slow = (await claimReq(t, env.id, { recipientAddress: addressOf('slow') })).body as ClaimApproval;
    await t.db.share.updateMany({ where: { envelopeId: env.id }, data: { reservedUntil: new Date(Date.now() - 1000) } });

    const fast = await claimReq(t, env.id, { recipientAddress: addressOf('fast') });
    expect(fast.status).toBe(201);
    expect(fast.body.share.index).toBe(slow.share.index);

    const r = await broadcastReq(t, slow);
    expect([r.status, r.body.error.code]).toEqual([410, 'HOLD_EXPIRED']);
    expect((await t.db.claim.findUniqueOrThrow({ where: { id: slow.claimId } })).status).toBe('EXPIRED');
    expect((await broadcastReq(t, fast.body)).status).toBe(200);
  });

  it('refuses to relay a tx paying someone other than the approved recipient', async () => {
    const env = await fundedEnvelope(t);
    const a = (await claimReq(t, env.id, { recipientAddress: addressOf('honest') })).body as ClaimApproval;
    const evil = binToHex(p2pkh(pub(key('evil'))));
    const relay = vi.spyOn(t.provider, 'sendRawTransaction');
    const r = await broadcastReq(t, a, { recipientLockingBytecode: evil });
    expect(r.status).toBe(400);
    expect(r.body.error.reasons).toContain('the transaction must pay only the approved address (a seal output and an optional BCH output)');
    expect(relay).not.toHaveBeenCalled(); // refused by the API itself, not by the network
    relay.mockRestore();
  });

  it('broadcast is idempotent for the same tx', async () => {
    const env = await fundedEnvelope(t);
    const a = (await claimReq(t, env.id, { recipientAddress: addressOf('twice') })).body as ClaimApproval;
    const first = await broadcastReq(t, a);
    const second = await broadcastReq(t, a);
    expect(second.status).toBe(200);
    expect(second.body.txid).toBe(first.body.txid);
  });
});

describe('review fixes: one outpoint per recipient, idempotency, atomic limits', () => {
  const lapse = (envelopeId: string) =>
    t.db.share.updateMany({ where: { envelopeId, status: { in: ['RESERVED', 'HELD'] } }, data: { reservedUntil: new Date(Date.now() - 1000) } });

  it('#6: a recipient never gets approvals for two different shares', async () => {
    const env = await fundedEnvelope(t);
    const x1 = (await claimReq(t, env.id, { recipientAddress: addressOf('x') })).body as ClaimApproval;
    await lapse(env.id);
    const y = await claimReq(t, env.id, { recipientAddress: addressOf('y') }, '203.0.113.2');
    expect(y.body.share.index).toBe(x1.share.index); // Y takes X's lapsed share

    // X comes back while Y holds X's share: refused instead of signing a second outpoint.
    const x2 = await claimReq(t, env.id, { recipientAddress: addressOf('x') });
    expect([x2.status, x2.body.error.code]).toEqual([409, 'ALREADY_CLAIMED']);
    // A hold doesn't help either: the hold lands on another share, X stays pinned to the first.
    const h = await t.http().post(`/envelopes/${env.id}/holds`).set('x-forwarded-for', '203.0.113.1').send({});
    const x3 = await claimReq(t, env.id, { recipientAddress: addressOf('x'), holdToken: h.body.holdToken });
    expect(x3.body.error.code).toBe('ALREADY_CLAIMED');

    // Once Y's reservation lapses, X gets the SAME share again.
    await lapse(env.id);
    const x4 = (await claimReq(t, env.id, { recipientAddress: addressOf('x') })).body as ClaimApproval;
    expect(x4.share).toEqual(x1.share);
    const row = await t.db.claim.findUniqueOrThrow({ where: { id: x4.claimId } });
    expect(row.approvedShareIds).toHaveLength(1);
    expect((await broadcastReq(t, x4)).status).toBe(200);
  });

  it('review-2 P1-13: the pin holds while another claim of that share is unconfirmed, and lifts once it is mined', async () => {
    const env = await fundedEnvelope(t);
    const x1 = (await claimReq(t, env.id, { recipientAddress: addressOf('px') })).body as ClaimApproval;
    await lapse(env.id);
    const y = (await claimReq(t, env.id, { recipientAddress: addressOf('py') }, '203.0.113.2')).body as ClaimApproval;
    expect(y.share).toEqual(x1.share);
    expect((await broadcastReq(t, y)).status).toBe(200); // Y's claim tx is out, but not mined

    // X's stale approval could still beat Y's tx in a double-spend race: no second share yet.
    const x2 = await claimReq(t, env.id, { recipientAddress: addressOf('px') });
    expect([x2.status, x2.body.error.code]).toEqual([409, 'ALREADY_CLAIMED']);

    // Y's claim is mined: X's old approval is dead for good, so X may claim another share.
    await t.db.claim.update({ where: { id: y.claimId }, data: { status: 'CONFIRMED' } });
    const x3 = await claimReq(t, env.id, { recipientAddress: addressOf('px') });
    expect(x3.status).toBe(201);
    expect(x3.body.share.outpointIndex).not.toBe(x1.share.outpointIndex);
  });

  it('#10: a lapsed retry is re-reserved on the same outpoint with a fresh timer', async () => {
    const env = await fundedEnvelope(t);
    const a = (await claimReq(t, env.id, { recipientAddress: addressOf('r') })).body as ClaimApproval;
    await lapse(env.id);
    const b = (await claimReq(t, env.id, { recipientAddress: addressOf('r') })).body as ClaimApproval;
    expect(b.share).toEqual(a.share);
    expect(new Date(b.reservedUntil).getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it('#8: two identical broadcasts at once record the claim exactly once', async () => {
    const env = await fundedEnvelope(t);
    const a = (await claimReq(t, env.id, { recipientAddress: addressOf('tap') })).body as ClaimApproval;
    const [r1, r2] = await Promise.all([broadcastReq(t, a), broadcastReq(t, a)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.txid).toBe(r2.body.txid);
    expect(await t.db.event.count({ where: { envelopeId: env.id, type: 'claimed' } })).toBe(1);
  });

  it('#7: 12 parallel wrong quiz answers from one IP — exactly 5 are judged, the rest are rate-limited', async () => {
    const env = await fundedEnvelope(t, { mode: 'QUIZ', quiz: { question: 'q?', answers: ['right'] } });
    const rs = await Promise.all(
      Array.from({ length: 12 }, (_, i) => claimReq(t, env.id, { recipientAddress: addressOf(`g${i}`), answer: `wrong${i}` }, '10.3.3.3')),
    );
    expect(rs.filter((r) => r.body.error.code === 'WRONG_ANSWER')).toHaveLength(5);
    expect(rs.filter((r) => r.body.error.code === 'RATE_LIMITED')).toHaveLength(7);
  });

  it('#7: parallel holds from one IP respect the hold limit', async () => {
    const env = await fundedEnvelope(t, { shareCount: 10, totalSats: 100_000 });
    const rs = await Promise.all(
      Array.from({ length: 8 }, () => t.http().post(`/envelopes/${env.id}/holds`).set('x-forwarded-for', '10.4.4.4').send({})),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2); // LIMITS.hold (review-2 P1-10)
    expect(await t.db.share.count({ where: { envelopeId: env.id, status: 'HELD' } })).toBe(2);
  });

  it('review-2 P1-10: at most half the shares can be held at once; wallets can still claim', async () => {
    const env = await fundedEnvelope(t, { shareCount: 10, totalSats: 100_000 });
    const rs = [];
    for (let i = 0; i < 6; i++) rs.push(await t.http().post(`/envelopes/${env.id}/holds`).set('x-forwarded-for', `10.5.5.${i}`).send({}));
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 429]);
    expect(await t.db.share.count({ where: { envelopeId: env.id, status: 'HELD' } })).toBe(5);
    expect((await claimReq(t, env.id, { recipientAddress: addressOf('has-wallet') }, '10.5.6.1')).status).toBe(201);
  });
});
