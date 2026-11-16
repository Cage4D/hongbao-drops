// §10.1 mainnet caps on POST /envelopes (422 BUDGET_CAP). No mainnet funds involved: nothing is funded.
import { afterEach, describe, expect, it } from 'vitest';
import type { CreateEnvelopeResponse } from '@hongbao/shared';
import { addSenderUtxo, createBody, fundFromTemplate, makeApp, resetDb } from './helpers.js';

const MAINNET = {
  NETWORK: 'MAINNET',
  TREASURY_ADDRESS: 'bitcoincash:qrm75mfwuwpw93wnrra2grcnqxtc23dctqdpgd5dwc',
};
const SENDER = 'bitcoincash:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwg2cucf9f0';

let t: Awaited<ReturnType<typeof makeApp>> | undefined;
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

  it('MAX_ENVELOPE_SATS applies when the price is unknown', async () => {
    const t = await mainnet({}, null);
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 200_001 })))).toEqual([422, 'BUDGET_CAP', 'MAX_ENVELOPE_SATS']);
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
    const t = await mainnet({ DAILY_MAINNET_SATS: '10000000', MAX_ACTIVE_MAINNET_SATS: '10000000' });
    await t.db.ledgerEntry.create({ data: { kind: 'CLAIMED', sats: 2_350_000n, usd: 4.7, txid: 'x' } });
    expect((await t.http().post('/envelopes').send(body({ totalSats: 100_000 }))).status).toBe(201); // $0.20 → $4.90
    expect(cap(await t.http().post('/envelopes').send(body({ totalSats: 100_000 })))).toEqual([422, 'BUDGET_CAP', 'BUDGET_TOTAL_USD']);
  });

  it('caps do not apply on chipnet', async () => {
    t = await makeApp();
    await resetDb(t.db);
    expect((await t.http().post('/envelopes').send(createBody({ shareCount: 20, totalSats: 5_000_000 }))).status).toBe(201);
  });
});
