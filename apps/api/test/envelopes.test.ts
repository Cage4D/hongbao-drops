// POST /envelopes, POST /envelopes/:id/funded, GET /envelopes/:id, GET /s/:slug against a real DB.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import type { CreateEnvelopeResponse } from '@hongbao/shared';
import { KeysService } from '../src/keys/keys.service.js';
import { addSenderUtxo, createBody, fundFromTemplate, makeApp, resetDb, sender, TREASURY_ADDRESS } from './helpers.js';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => (t = await makeApp()));
afterAll(async () => t.app.close());
beforeEach(async () => resetDb(t.db));

const create = async (over: Record<string, unknown> = {}) => {
  const r = await t.http().post('/envelopes').send(createBody(over));
  return r;
};

describe('POST /envelopes', () => {
  it('creates a BCH-only envelope with contract, gate key and funding template', async () => {
    const r = await create();
    expect(r.status).toBe(201);
    const b = r.body as CreateEnvelopeResponse;
    expect(b.slug).toMatch(/^[2-9a-hjkmnp-z]{6}$/);
    expect(b.contractAddress).toMatch(/^bchtest:r/); // token-aware P2SH32
    expect(b.gatePk).toBe(binToHex(t.app.get(KeysService).gatePublicKey(b.envelopeSeq)));
    expect(b.constructorArgs.maxFee).toBe(1000);
    expect(b.shareAmounts).toEqual([10_000, 10_000, 10_000]);
    expect(b.fundingTemplate.map((o) => o.purpose)).toEqual(['SHARE', 'SHARE', 'SHARE']);
    expect(b.requiredOutputs).toEqual([]);
  });

  it('gives each envelope its own gate key', async () => {
    const a = (await create()).body as CreateEnvelopeResponse;
    const b = (await create()).body as CreateEnvelopeResponse;
    expect(a.gatePk).not.toBe(b.gatePk);
    expect(a.contractAddress).not.toBe(b.contractAddress);
  });

  it.each([
    ['bad linkPk', { linkPk: '04' + 'ab'.repeat(32) }, 'linkPk'],
    ['expiry too soon', { expiry: Math.floor(Date.now() / 1000) + 60 }, 'expiry'],
    ['expiry too far', { expiry: Math.floor(Date.now() / 1000) + 60 * 24 * 3600 }, 'expiry'],
    ['shares below dust floor', { totalSats: 4_000 }, 'totalSats'],
    ['stamps without stampCategory', { withStamps: true }, 'stampCategory'],
    ['quiz mode without quiz', { mode: 'QUIZ' }, 'quiz'],
    ['mainnet sender on chipnet', { senderAddress: 'bitcoincash:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwg2cucf9f0' }, 'senderAddress'],
    ['unknown field', { foo: 1 }, ''],
  ])('rejects %s with INVALID_REQUEST', async (_n, over, path) => {
    const r = await create(over);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_REQUEST');
    expect(r.body.error.message).toBe("Something in that request doesn't look right.");
    if (path) expect(r.body.error.issues.map((i: { path: string }) => i.path)).toContain(path);
  });

  it('stores quiz answers only as salted hashes', async () => {
    const r = await create({ mode: 'QUIZ', quiz: { question: 'Which chain?', answers: ['  Bitcoin   Cash ', 'BCH'] } });
    expect(r.status).toBe(201);
    const row = await t.db.envelope.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(row.quizAnswerHashes).toHaveLength(2);
    expect(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(/bitcoin cash|"bch"/i);
    const want = binToHex(sha256.hash(new TextEncoder().encode(row.quizSalt + 'bitcoin cash')));
    expect(row.quizAnswerHashes[0]).toBe(want);
  });

  it('rejects an unknown sponsor token', async () => {
    const r = await create({ sponsorToken: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /envelopes/:id/funded', () => {
  it('BCH-only: NOT_FUNDED until the tx exists, then ACTIVE; idempotent', async () => {
    const created = (await create()).body as CreateEnvelopeResponse;
    const utxo = addSenderUtxo(t.provider);

    const early = await t.http().post(`/envelopes/${created.id}/funded`).send({ txid: 'ab'.repeat(32) });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('NOT_FUNDED');

    const txid = await fundFromTemplate(t.provider, created, utxo);
    const r = await t.http().post(`/envelopes/${created.id}/funded`).send({ txid });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ACTIVE');
    expect(r.body.shares.map((s: { outpoint: string }) => s.outpoint)).toEqual([0, 1, 2].map((i) => `${txid}:${i}`));
    expect(r.body.shares[0].usd).toBe(0.02); // 10,000 sats at $200

    const again = await t.http().post(`/envelopes/${created.id}/funded`).send({ txid });
    expect(again.status).toBe(200);
    expect(await t.db.share.count()).toBe(3);
  });

  it('stamps: verifies identity, NFTs, BCMR; stores the exact registry bytes', async () => {
    const utxo = addSenderUtxo(t.provider);
    const created = (await create({ withStamps: true, stampCategory: utxo.txid })).body as CreateEnvelopeResponse;
    expect(created.fundingTemplate.map((o) => o.purpose)).toEqual(['IDENTITY', 'SHARE', 'SHARE', 'SHARE', 'BCMR']);
    expect(created.fundingTemplate[1]!.token).toEqual({ category: utxo.txid, nftCommitment: binToHex(Uint8Array.of(created.envelopeSeq, 0, 0, 0, 1)) });

    const row = await t.db.envelope.findUniqueOrThrow({ where: { id: created.id } });
    expect(binToHex(sha256.hash(new TextEncoder().encode(row.bcmrRegistry!)))).toBe(created.bcmr!.hash);
    expect(created.bcmr!.uri).toBe(`api.hongbao.test/bcmr/${utxo.txid}.json`);
    const registry = JSON.parse(row.bcmrRegistry!);
    expect(Object.keys(registry.identities)).toEqual([utxo.txid]);

    const txid = await fundFromTemplate(t.provider, created, utxo);
    const r = await t.http().post(`/envelopes/${created.id}/funded`).send({ txid });
    expect(r.status).toBe(200);
    expect(r.body.shares.map((s: { nftCommitment: string }) => s.nftCommitment)).toHaveLength(3);
    expect(r.body.shares[0].outpoint).toBe(`${txid}:1`);
  });

  describe('rejects mismatching funding txs (envelope stays PENDING_FUNDING)', () => {
    const expectMismatch = async (id: string, txid: string, reason: RegExp) => {
      const r = await t.http().post(`/envelopes/${id}/funded`).send({ txid });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('FUNDING_MISMATCH');
      expect(r.body.error.reasons.join('\n')).toMatch(reason);
      expect((await t.db.envelope.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING_FUNDING');
      expect(await t.db.share.count({ where: { envelopeId: id } })).toBe(0);
    };

    it('shares that do not sum to the total', async () => {
      const created = (await create()).body as CreateEnvelopeResponse;
      const txid = await fundFromTemplate(t.provider, created, addSenderUtxo(t.provider), (o) =>
        o.map((x, i) => (i === 0 ? { ...x, amount: x.amount - 1_000n } : x)),
      );
      await expectMismatch(created.id, txid, /sum to 29000/);
    });

    it('a share paid to the wrong script', async () => {
      const created = (await create()).body as CreateEnvelopeResponse;
      const txid = await fundFromTemplate(t.provider, created, addSenderUtxo(t.provider), (o) =>
        o.map((x, i) => (i === 1 ? { ...x, to: hexToBin('76a914' + '00'.repeat(20) + '88ac') } : x)),
      );
      await expectMismatch(created.id, txid, /share 2: output 1 doesn't pay the envelope contract/);
    });

    it('an extra undeclared output to the contract', async () => {
      const created = (await create()).body as CreateEnvelopeResponse;
      const txid = await fundFromTemplate(t.provider, created, addSenderUtxo(t.provider), (o) => [...o, { ...o[0]!, amount: 5_000n }]);
      await expectMismatch(created.id, txid, /output 3 pays the contract but isn't a declared share/);
    });

    it('a missing BCMR output', async () => {
      const utxo = addSenderUtxo(t.provider);
      const created = (await create({ withStamps: true, stampCategory: utxo.txid })).body as CreateEnvelopeResponse;
      const txid = await fundFromTemplate(t.provider, created, utxo, (o) => o.slice(0, -1));
      await expectMismatch(created.id, txid, /BCMR OP_RETURN/);
    });

    it('a wrong stamp commitment', async () => {
      const utxo = addSenderUtxo(t.provider);
      const created = (await create({ withStamps: true, stampCategory: utxo.txid })).body as CreateEnvelopeResponse;
      const txid = await fundFromTemplate(t.provider, created, utxo, (o) =>
        o.map((x, i) => (i === 2 ? { ...x, token: { ...x.token!, nft: { capability: 'none' as const, commitment: 'ffffffff7f' } } } : x)),
      );
      await expectMismatch(created.id, txid, /share 2: stamp commitment ffffffff7f/);
    });

    it('an EQUAL envelope funded with an unequal split (review #12)', async () => {
      const created = (await create()).body as CreateEnvelopeResponse;
      const txid = await fundFromTemplate(t.provider, created, addSenderUtxo(t.provider), (o) =>
        o.map((x, i) => ({ ...x, amount: i === 0 ? 26_000n : 2_000n })),
      );
      await expectMismatch(created.id, txid, /EQUAL envelope must split as 10000, 10000, 10000/);
    });

    it('a stamped funding that also mints a minting NFT for the sender (review #9)', async () => {
      const utxo = addSenderUtxo(t.provider);
      const created = (await create({ withStamps: true, stampCategory: utxo.txid })).body as CreateEnvelopeResponse;
      const txid = await fundFromTemplate(t.provider, created, utxo, (o) => [
        ...o,
        { to: sender, amount: 1_000n, token: { category: utxo.txid, amount: 0n, nft: { capability: 'minting' as const, commitment: '' } } },
      ]);
      await expectMismatch(created.id, txid, /output 5 carries a token of the stamp category/);
    });

    it('a sponsored drop without the treasury fee output', async () => {
      const token = 'sponsor-secret-token';
      await t.db.sponsor.create({
        data: { name: 'Acme', adminToken: binToHex(sha256.hash(new TextEncoder().encode(token))) },
      });
      const created = (await create({ sponsorToken: token, totalSats: 100_000 })).body as CreateEnvelopeResponse;
      expect(created.requiredOutputs).toEqual([
        expect.objectContaining({ purpose: 'SPONSOR_FEE', sats: 3_000, outputIndex: 3 }),
      ]);
      const txid = await fundFromTemplate(t.provider, created, addSenderUtxo(t.provider), (o) => o.slice(0, 3));
      await expectMismatch(created.id, txid, /3000-sat sponsor fee/);

      // …and with the fee it activates.
      const created2 = (await create({ sponsorToken: token, totalSats: 100_000 })).body as CreateEnvelopeResponse;
      const txid2 = await fundFromTemplate(t.provider, created2, addSenderUtxo(t.provider));
      expect((await t.http().post(`/envelopes/${created2.id}/funded`).send({ txid: txid2 })).body.status).toBe('ACTIVE');
    });
  });

  it('refuses to reuse one funding tx for a second envelope', async () => {
    const a = (await create()).body as CreateEnvelopeResponse;
    const b = (await create()).body as CreateEnvelopeResponse;
    const txid = await fundFromTemplate(t.provider, a, addSenderUtxo(t.provider));
    expect((await t.http().post(`/envelopes/${a.id}/funded`).send({ txid })).status).toBe(200);
    const r = await t.http().post(`/envelopes/${b.id}/funded`).send({ txid });
    expect(r.status).toBe(422); // b's contract differs, so the outputs don't match
  });
});

describe('GET /envelopes/:id and /s/:slug', () => {
  it('shows the public view in sats + USD without secrets', async () => {
    const utxo = addSenderUtxo(t.provider);
    const created = (await create({ withStamps: true, stampCategory: utxo.txid, message: 'Happy New Year!', theme: 'lunar' }))
      .body as CreateEnvelopeResponse;
    const pending = await t.http().get(`/envelopes/${created.id}`);
    expect(pending.body.status).toBe('PENDING_FUNDING');

    const txid = await fundFromTemplate(t.provider, created, utxo);
    await t.http().post(`/envelopes/${created.id}/funded`).send({ txid });

    const r = await t.http().get(`/s/${created.slug}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: created.id,
      status: 'ACTIVE',
      theme: 'lunar',
      message: 'Happy New Year!',
      total: { sats: 30_000, usd: 0.06 },
      remaining: { sats: 30_000, usd: 0.06 },
      shares: { total: 3, claimed: 0, left: 3 },
      fundingTxid: txid,
      stamp: { category: utxo.txid, imageUrl: `https://api.hongbao.test/stamps/${utxo.txid}/collection.png` },
    });
    expect(r.body.stamp.alt).toMatch(/Lunar New Year red envelope stamp/);
    expect(r.body.og).toMatchObject({ imageUrl: `https://api.hongbao.test/og/${created.slug}.png`, width: 1200, height: 630 });
    expect(r.body.og.alt).toMatch(/Lunar New Year red envelope: "Happy New Year!", 3 of 3 shares left/);
    expect(r.body.secondsLeft).toBeGreaterThan(1700);
    const text = JSON.stringify(r.body);
    for (const secret of ['gatePk', 'linkPk', 'quizSalt', 'quizAnswerHashes', 'senderAddress', 'bcmrRegistry']) {
      expect(text).not.toContain(secret);
    }
  });

  it('404s unknown envelopes and slugs', async () => {
    expect((await t.http().get('/envelopes/nope')).body.error.code).toBe('NOT_FOUND');
    expect((await t.http().get('/s/zzzzzz')).status).toBe(404);
  });
});

describe('GET /health', () => {
  it('reports db, chain, network and price', async () => {
    const r = await t.http().get('/health');
    expect(r.body).toMatchObject({ ok: true, network: 'CHIPNET', db: true, chain: { ok: true, server: 'mock' }, priceUsd: 200 });
    expect(TREASURY_ADDRESS).toMatch(/^bchtest:/);
  });
});
