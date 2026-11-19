// Phase 8: /admin/budget (spend ledger, §10.1 rule 7) and /admin/demo (one demo envelope at a time).
// Mainnet config against the mock chain — no real money involved.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encodeCashAddress, hash160 } from '@bitauth/libauth';
import { buildClaimTx } from '@hongbao/contract';
import type { ClaimApproval, CreateEnvelopeResponse } from '@hongbao/shared';
import { addSenderUtxo, createBody, fundFromTemplate, key, linkPriv, makeApp, pub, resetDb } from './helpers.js';

const ADMIN = { authorization: `Bearer ${'a'.repeat(32)}` }; // testConfig ADMIN_TOKEN
const mainnetAddr = (label: string) =>
  encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkhWithTokens', payload: hash160(pub(key(label))) }).address;

let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(
  async () =>
    (t = await makeApp({
      NETWORK: 'MAINNET',
      TREASURY_ADDRESS: 'bitcoincash:qrm75mfwuwpw93wnrra2grcnqxtc23dctqdpgd5dwc',
      BUDGET_WALLET_ADDRESS: 'bitcoincash:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwg2cucf9f0', // = the test sender
    })),
);
afterAll(async () => t.app.close());
beforeEach(async () => resetDb(t.db)); // $200/BCH

async function mainnetEnvelope(shareCount = 2, totalSats = 20_000, hours = 0.5) {
  const utxo = addSenderUtxo(t.provider);
  const expiry = Math.floor(Date.now() / 1000) + Math.round(hours * 3600);
  const r = await t.http().post('/envelopes').send(createBody({ senderAddress: 'bitcoincash:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwg2cucf9f0', shareCount, totalSats, expiry }));
  expect(r.status).toBe(201);
  const env = r.body as CreateEnvelopeResponse;
  const txid = await fundFromTemplate(t.provider, env, utxo);
  expect((await t.http().post(`/envelopes/${env.id}/funded`).send({ txid })).status).toBe(200);
  return env;
}
async function claim(envId: string, who: string) {
  const a = (await t.http().post(`/envelopes/${envId}/claims`).set('x-forwarded-for', `10.8.0.${who.length}`).send({ recipientAddress: mainnetAddr(who) })).body as ClaimApproval;
  const { hex } = buildClaimTx({ provider: t.provider, constructorArgs: a.constructorArgs, share: a.share, recipientLockingBytecode: a.recipientLockingBytecode, linkPrivateKey: linkPriv, gateSig: a.gateSig });
  expect((await t.http().post(`/claims/${a.claimId}/broadcast`).send({ rawTx: hex })).status).toBe(200);
}

describe('/admin auth', () => {
  it('requires the admin token', async () => {
    for (const path of ['/admin/budget', '/admin/demo']) {
      expect((await t.http().get(path)).status).toBe(401);
      expect((await t.http().get(path).set({ authorization: 'Bearer nope' })).status).toBe(401);
    }
    expect((await t.http().post('/admin/demo/refill').send({ envelopeId: 'x' })).status).toBe(401);
  });
});

describe('GET /admin/budget', () => {
  it('summarises the mainnet ledger: funded, claimed (spent), locked, remaining', async () => {
    const env = await mainnetEnvelope(2, 20_000);
    await claim(env.id, 'judge');
    const b = (await t.http().get('/admin/budget').set(ADMIN)).body;
    expect(b).toMatchObject({
      network: 'MAINNET',
      budgetWallet: 'bitcoincash:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwg2cucf9f0',
      priceUsd: 200,
      priceLive: true,
      budgetTotalUsd: 5,
      fundedSats: 20_000,
      claimedSats: 10_000,
      refundedSats: 0,
      lockedSats: 10_000,
      pendingSats: 0,
      spentUsdTotal: 0.02, // 10,000 sats × $200
      lockedUsd: 0.02,
      remainingBudgetUsd: 4.96,
      warning: null,
      ledger: { FUND: 20_000, CLAIMED: 10_000, REFUNDED: 0, FEE: 0 }, // audit log agrees
    });
    expect(b.caps.MAX_ENVELOPE_USD).toBe(0.5);
  });

  it('warns at 80% of the budget', async () => {
    // $4.10 given away (shares claimed: however they were recorded, they count).
    const env = await mainnetEnvelope(2, 20_000);
    await t.db.share.updateMany({ where: { envelopeId: env.id }, data: { status: 'CLAIMED', sats: 1_025_000n } });
    const b = (await t.http().get('/admin/budget').set(ADMIN)).body;
    expect(b.warning).toMatch(/82% of the \$5 budget/);
  });
});

describe('/admin/demo', () => {
  it('registers one demo envelope at a time', async () => {
    expect((await t.http().get('/admin/demo').set(ADMIN)).body).toMatchObject({ envelopeId: null, needsRefill: true });
    const first = await mainnetEnvelope(1, 10_000, 23);
    const r1 = await t.http().post('/admin/demo/refill').set(ADMIN).send({ envelopeId: first.id });
    expect(r1.body).toMatchObject({ envelopeId: first.id, slug: first.slug, sharesLeft: 1, needsRefill: false });

    const second = await mainnetEnvelope(1, 10_000, 23);
    const early = await t.http().post('/admin/demo/refill').set(ADMIN).send({ envelopeId: second.id });
    expect([early.status, early.body.error.cap]).toEqual([422, 'DEMO_ONE_AT_A_TIME']);

    await claim(first.id, 'judge');
    expect((await t.http().get('/admin/demo').set(ADMIN)).body).toMatchObject({ sharesLeft: 0, needsRefill: true });
    const r2 = await t.http().post('/admin/demo/refill').set(ADMIN).send({ envelopeId: second.id });
    expect(r2.body).toMatchObject({ envelopeId: second.id, needsRefill: false });
  });

  it('takes the next demo once the current one is in its last 16 hours', async () => {
    const first = await mainnetEnvelope(1, 10_000, 23);
    await t.http().post('/admin/demo/refill').set(ADMIN).send({ envelopeId: first.id });
    const second = await mainnetEnvelope(1, 10_000, 23);
    expect((await t.http().post('/admin/demo/refill').set(ADMIN).send({ envelopeId: second.id })).status).toBe(422);
    await t.db.envelope.update({ where: { id: first.id }, data: { expiry: Math.floor(Date.now() / 1000) + 15 * 3600 } });
    const r = await t.http().post('/admin/demo/refill').set(ADMIN).send({ envelopeId: second.id });
    expect(r.body).toMatchObject({ envelopeId: second.id, needsRefill: false });
  });

  it('GET /demo (public) names the open demo envelope, and nothing once it is used up', async () => {
    expect((await t.http().get('/demo')).body).toEqual({ slug: null, sharesLeft: 0, sharesTotal: 0, secondsLeft: 0 });
    const env = await mainnetEnvelope(1, 10_000, 23);
    await t.http().post('/admin/demo/refill').set(ADMIN).send({ envelopeId: env.id });
    const open = (await t.http().get('/demo')).body;
    expect(open).toMatchObject({ slug: env.slug, sharesLeft: 1, sharesTotal: 1 });
    expect(open.secondsLeft).toBeGreaterThan(0);
    await claim(env.id, 'judge');
    expect((await t.http().get('/demo')).body).toMatchObject({ slug: null, sharesLeft: 0 });
  });

  it('refuses unfunded envelopes as demo', async () => {
    const r = await t.http().post('/envelopes').send(createBody({ senderAddress: 'bitcoincash:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwg2cucf9f0' }));
    const res = await t.http().post('/admin/demo/refill').set(ADMIN).send({ envelopeId: r.body.id });
    expect(res.body.error.code).toBe('NOT_FUNDED');
  });
});
