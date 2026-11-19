// §10.1 mainnet caps on POST /envelopes (422 BUDGET_CAP). No mainnet funds involved: nothing is funded.
import { afterEach, describe, expect, it } from 'vitest';
import type { CreateEnvelopeResponse } from '@hongbao/shared';
import { encodeCashAddress, hash160 } from '@bitauth/libauth';
import { BudgetService } from '../src/budget/budget.service.js';
import { addSenderUtxo, createBody, fundFromTemplate, key, makeApp, pub, resetDb } from './helpers.js';

const SENDER = 'bitcoincash:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwg2cucf9f0'; // = BUDGET_WALLET_ADDRESS (the demo wallet)
// Someone funding envelopes with their own BCH.
const JUDGE = encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload: hash160(pub(key('judge'))) }).address;
const MAINNET = {
  NETWORK: 'MAINNET',
  TREASURY_ADDRESS: 'bitcoincash:qrm75mfwuwpw93wnrra2grcnqxtc23dctqdpgd5dwc',
  BUDGET_WALLET_ADDRESS: SENDER,
};

type TestApp = Awaited<ReturnType<typeof makeApp>>;
let t: TestApp | undefined;
afterEach(async () => {
  await t?.app.close();
  t = undefined;
});

async function mainnet(over: Record<string, string> = {}, priceUsd: number | null = 200) {
  t = await makeApp({ ...MAINNET, ...over });
  await resetDb(t.db, priceUsd ?? 1);
  if (priceUsd === null) await t.db.setting.deleteMany();
  return t;
}
const body = (over: Record<string, unknown> = {}) => createBody({ senderAddress: SENDER, ...over });
const cap = (r: { status: number; body: { error?: { code: string; cap?: string } } }) => [r.status, r.body.error?.code, r.body.error?.cap];

/** Create + fund a demo-wallet envelope through the API. */
async function funded(t: TestApp, totalSats: number) {
  const utxo = addSenderUtxo(t.provider, BigInt(totalSats) + 100_000n);
  const r = await t.http().post('/envelopes').send(body({ totalSats }));
  expect(r.status).toBe(201);
  const txid = await fundFromTemplate(t.provider, r.body as CreateEnvelopeResponse, utxo);
  const f = await t.http().post(`/envelopes/${r.body.id}/funded`).send({ txid });
  expect(f.status).toBe(200);
  return r.body as CreateEnvelopeResponse;
}
/** Make `sats` count as already given away: a funded envelope whose shares were all claimed. */
async function claimedSats(t: TestApp, sats: bigint) {
  const env = await funded(t, 6_000);
  const shares = await t.db.share.findMany({ where: { envelopeId: env.id } });
  await t.db.share.update({ where: { id: shares[0]!.id }, data: { status: 'CLAIMED', sats } });
  await t.db.share.updateMany({ where: { envelopeId: env.id, NOT: { id: shares[0]!.id } }, data: { status: 'CLAIMED', sats: 0n } });
}

describe('mainnet budget caps', () => {
  it('MAX_SHARES = 10', async () => {
    const t = await mainnet();
    expect(cap(await t.http().post('/envelopes').send(body({ shareCount: 11, totalSats: 22_000 })))).toEqual([422, 'BUDGET_CAP', 'MAX_SHARES']);
    expect((await t.http().post('/envelopes').send(body({ shareCount: 10, totalSats: 20_000 }))).status).toBe(201);
  });

  it('MAX_ENVELOPE_USD = $0.50', async () => {
    const t = await mainnet();
    // 300,000 sats × $200/BCH = $0.60
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 300_000 })))).toEqual([422, 'BUDGET_CAP', 'MAX_ENVELOPE_USD']);
    expect((await t.http().post('/envelopes').send(body({ totalSats: 200_000 })))).toHaveProperty('status', 201);
  });

  it('review-2 P1-4: with no price known, the USD caps use the conservative fallback price', async () => {
    const t = await mainnet({}, null); // BUDGET_FALLBACK_BCH_USD = 500
    // 120,000 sats × $500 = $0.60 > $0.50 (it would pass at the real ~$200)
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 120_000 })))).toEqual([422, 'BUDGET_CAP', 'MAX_ENVELOPE_USD']);
    expect((await t.http().post('/envelopes').send(body({ totalSats: 90_000 }))).status).toBe(201);
  });

  it('review-2 P1-4: BUDGET_TOTAL_USD is still enforced with no price known', async () => {
    const t = await mainnet({ DAILY_MAINNET_SATS: '100000000', MAX_ACTIVE_MAINNET_SATS: '100000000', BUDGET_TOTAL_USD: '1' }, null);
    for (let i = 0; i < 2; i++) expect((await t.http().post('/envelopes').send(body({ totalSats: 90_000 }))).status).toBe(201); // $0.90 at $500
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 90_000 })))).toEqual([422, 'BUDGET_CAP', 'BUDGET_TOTAL_USD']);
  });

  it('MAX_ENVELOPE_SATS also applies when the price is cheap', async () => {
    const t = await mainnet({}, 50); // 250,000 sats = $0.125 — under the USD cap, over the sats cap
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 250_000 })))).toEqual([422, 'BUDGET_CAP', 'MAX_ENVELOPE_SATS']);
  });

  it('DAILY_MAINNET_SATS = 400,000 (counts recent unfunded envelopes too)', async () => {
    const t = await mainnet();
    for (let i = 0; i < 2; i++) expect((await t.http().post('/envelopes').send(body({ totalSats: 200_000 }))).status).toBe(201);
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 2_000 * 3 })))).toEqual([422, 'BUDGET_CAP', 'DAILY_MAINNET_SATS']);
  });

  it('MAX_ACTIVE_MAINNET_SATS = 600,000', async () => {
    const t = await mainnet({ DAILY_MAINNET_SATS: '10000000' });
    for (let i = 0; i < 3; i++) expect((await t.http().post('/envelopes').send(body({ totalSats: 200_000 }))).status).toBe(201);
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 6_000 })))).toEqual([422, 'BUDGET_CAP', 'MAX_ACTIVE_MAINNET_SATS']);
  });

  it('human message from the catalog', async () => {
    const t = await mainnet();
    const r = await t.http().post('/envelopes').send(body({ shareCount: 11, totalSats: 22_000 }));
    expect(r.body.error.message).toBe('Demo limit reached for this envelope size.');
  });

  it('never-funded envelopes stop counting after an hour, even once EXPIRED (review #3)', async () => {
    const t = await mainnet();
    for (let i = 0; i < 2; i++) expect((await t.http().post('/envelopes').send(body({ totalSats: 200_000 }))).status).toBe(201);
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 6_000 })))[2]).toBe('DAILY_MAINNET_SATS');
    // An hour later the keeper has marked them EXPIRED; they must no longer block the demo.
    await t.db.envelope.updateMany({ data: { status: 'EXPIRED', createdAt: new Date(Date.now() - 61 * 60_000) } });
    expect((await t.http().post('/envelopes').send(body({ totalSats: 200_000 }))).status).toBe(201);
  });

  it('funding an old pending envelope re-checks the caps (review #5)', async () => {
    const t = await mainnet({ DAILY_MAINNET_SATS: '10000000' });
    const created: { env: CreateEnvelopeResponse; utxo: ReturnType<typeof addSenderUtxo> }[] = [];
    const mk = async () => {
      const utxo = addSenderUtxo(t.provider, 300_000n);
      const r = await t.http().post('/envelopes').send(body({ totalSats: 200_000 }));
      expect(r.status).toBe(201);
      created.push({ env: r.body, utxo });
    };
    for (let i = 0; i < 3; i++) await mk();
    await t.db.envelope.updateMany({ data: { createdAt: new Date(Date.now() - 61 * 60_000) } }); // aged out
    for (let i = 0; i < 3; i++) await mk(); // allowed: the old three no longer count

    const results: (string | number)[] = [];
    for (const { env, utxo } of created) {
      const txid = await fundFromTemplate(t.provider, env, utxo);
      const r = await t.http().post(`/envelopes/${env.id}/funded`).send({ txid });
      results.push(r.status === 200 ? r.body.status : r.body.error.cap);
    }
    // 600,000 sats cap: three can go ACTIVE, the rest are refused (and stay PENDING → refund after expiry).
    expect(results.filter((x) => x === 'ACTIVE')).toHaveLength(3);
    expect(results.filter((x) => x === 'MAX_ACTIVE_MAINNET_SATS')).toHaveLength(3);
    expect(await t.db.envelope.count({ where: { status: 'ACTIVE' } })).toBe(3);
  });

  it('parallel creates cannot both squeeze under a cap (review #5)', async () => {
    const t = await mainnet();
    const rs = await Promise.all(
      Array.from({ length: 4 }, (_, i) => t.http().post('/envelopes').set('x-forwarded-for', `10.7.0.${i}`).send(body({ totalSats: 200_000 }))),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
    expect(rs.filter((r) => r.body.error?.cap === 'DAILY_MAINNET_SATS')).toHaveLength(2);
  });

  it('BUDGET_TOTAL_USD: spent + locked + new may not exceed $5', async () => {
    const t = await mainnet({ DAILY_MAINNET_SATS: '100000000', MAX_ACTIVE_MAINNET_SATS: '100000000' });
    await claimedSats(t, 2_350_000n); // $4.70 spent
    expect((await t.http().post('/envelopes').send(body({ totalSats: 100_000 }))).status).toBe(201); // $0.20 → $4.90
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 100_000 })))).toEqual([422, 'BUDGET_CAP', 'BUDGET_TOTAL_USD']);
  });

  it('review-2 P1-2/P1-3: spending counts claims however they were recorded; locked counts only unspent shares', async () => {
    const t = await mainnet({ DAILY_MAINNET_SATS: '100000000' });
    // Three funded envelopes fill MAX_ACTIVE_MAINNET_SATS (600,000)…
    const envs = [];
    for (let i = 0; i < 3; i++) envs.push(await funded(t, 200_000));
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 6_000 })))[2]).toBe('MAX_ACTIVE_MAINNET_SATS');
    // …then one is emptied outside the API (reconcile marks its shares; nothing writes a ledger row
    // and its status stays ACTIVE). Its sats now count as spent, not locked, so creating works again.
    await t.db.share.updateMany({ where: { envelopeId: envs[0]!.id }, data: { status: 'CLAIMED' } });
    expect((await t.http().post('/envelopes').send(body({ totalSats: 6_000 }))).status).toBe(201);
    const b = await t.app.get(BudgetService).state(t.db);
    expect(b.spentSats).toBe(200_000n);
    expect(b.lockedSats).toBe(400_000n);
  });

  it('review-2 Q1: totals count only the demo wallet; per-envelope caps apply to everyone', async () => {
    const t = await mainnet();
    for (let i = 0; i < 3; i++) expect((await t.http().post('/envelopes').send(body({ senderAddress: JUDGE, totalSats: 200_000 }))).status).toBe(201);
    // 600,000 sats of judges' envelopes didn't touch the 400,000-sat daily cap of the demo wallet.
    for (let i = 0; i < 2; i++) expect((await t.http().post('/envelopes').send(body({ totalSats: 200_000 }))).status).toBe(201);
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 6_000 })))[2]).toBe('DAILY_MAINNET_SATS');
    expect(cap(await t.http().post('/envelopes').send(body({ senderAddress: JUDGE, shareCount: 11, totalSats: 22_000 })))[2]).toBe('MAX_SHARES');
    expect(cap(await t.http().post('/envelopes').send(body({ senderAddress: JUDGE, totalSats: 300_000 })))[2]).toBe('MAX_ENVELOPE_USD');
  });

  it('review-2 P1-6/Q2: an envelope funded within the hour is not re-checked, so its coins are never locked out', async () => {
    const t = await mainnet();
    const utxo = addSenderUtxo(t.provider, 300_000n);
    const r = await t.http().post('/envelopes').send(body({ totalSats: 200_000 })); // $0.40 at $200
    expect(r.status).toBe(201);
    await t.db.setting.update({ where: { key: 'price.bchusd' }, data: { value: '300' } }); // now $0.60 > $0.50
    const txid = await fundFromTemplate(t.provider, r.body, utxo);
    const f = await t.http().post(`/envelopes/${r.body.id}/funded`).send({ txid });
    expect([f.status, f.body.status]).toEqual([200, 'ACTIVE']);
  });

  it('review-2 Q3: mainnet expiry is at most 24 h', async () => {
    const t = await mainnet();
    const in25h = Math.floor(Date.now() / 1000) + 25 * 3600;
    const r = await t.http().post('/envelopes').send(body({ expiry: in25h }));
    expect([r.status, r.body.error.code]).toEqual([400, 'INVALID_REQUEST']);
    expect((await t.http().post('/envelopes').send(body({ expiry: in25h - 2 * 3600 }))).status).toBe(201);
  });

  it('caps do not apply on chipnet', async () => {
    t = await makeApp();
    await resetDb(t.db);
    expect((await t.http().post('/envelopes').send(createBody({ shareCount: 20, totalSats: 5_000_000 }))).status).toBe(201);
  });
});
