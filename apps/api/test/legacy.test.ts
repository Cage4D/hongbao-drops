// The "Hongbao Seals" rename keeps everything already published working (src/common/legacy.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaimApproval, CreateEnvelopeResponse } from '@hongbao/shared';
import { LEGACY_ENABLE_ENV, LEGACY_MEDIA_PREFIX, LEGACY_REQUEST_FIELDS, LEGACY_RESPONSE_KEY, upgradeLegacyEnvelopeBody } from '../src/common/legacy.js';
import { addressOf, addSenderUtxo, broadcastReq, claimReq, createBody, fundedEnvelope, makeApp, resetDb, testConfig } from './helpers.js';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => (t = await makeApp()));
afterAll(async () => t.app.close());
beforeEach(async () => resetDb(t.db));

/** The pre-rename spelling of a create-envelope field. */
const oldName = (field: string) => Object.entries(LEGACY_REQUEST_FIELDS).find(([, n]) => n === field)![0];

describe('ENABLE_SEALS', () => {
  it('defaults to on, and wins over the legacy variable', () => {
    expect(testConfig().ENABLE_SEALS).toBe(true);
    expect(testConfig({ ENABLE_SEALS: 'false', [LEGACY_ENABLE_ENV]: 'true' }).ENABLE_SEALS).toBe(false);
  });
  it('falls back to the legacy variable with a deprecation warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(testConfig({ [LEGACY_ENABLE_ENV]: 'false' }).ENABLE_SEALS).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${LEGACY_ENABLE_ENV} is deprecated.*ENABLE_SEALS`)));
    warn.mockRestore();
  });
  it('rejects a bad legacy value', () => {
    expect(() => testConfig({ [LEGACY_ENABLE_ENV]: 'yes' })).toThrow(new RegExp(LEGACY_ENABLE_ENV));
  });
});

describe('old seal image URLs', () => {
  it('redirect permanently to /seals/…, open to any site, and the target serves the image', async () => {
    const env = await fundedEnvelope(t, { withSeals: true, shareCount: 2, totalSats: 10_000 });
    const category = env.fundingTemplate[1]!.token!.category;
    const commitment = env.fundingTemplate[1]!.token!.nftCommitment;
    for (const file of [`${commitment}.png`, `${commitment}.svg`, 'collection.png']) {
      const r = await t.http().get(`/${LEGACY_MEDIA_PREFIX}/${category}/${file}`).set('Origin', 'https://some-wallet.example');
      expect(r.status).toBe(301);
      expect(r.headers.location).toBe(`/seals/${category}/${file}`);
      expect(r.headers['access-control-allow-origin']).toBe('*');
      expect((await t.http().get(r.headers.location)).status).toBe(200);
    }
  });
  it('404s for malformed paths instead of redirecting them', async () => {
    expect((await t.http().get(`/${LEGACY_MEDIA_PREFIX}/not-a-category/x.png`)).status).toBe(404);
  });
  it('the BCMR path is unchanged', async () => {
    const env = await fundedEnvelope(t, { withSeals: true, shareCount: 2, totalSats: 10_000 });
    const category = env.fundingTemplate[1]!.token!.category;
    expect(env.bcmr!.uri).toMatch(new RegExp(`/bcmr/${category}\\.json$`));
    const r = await t.http().get(`/bcmr/${category}.json`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain('Hongbao Seal #');
  });
});

describe('frontend bundles built before the rename', () => {
  it('maps old request field names, new names winning', () => {
    const [oldWith, oldCategory] = [oldName('withSeals'), oldName('sealCategory')];
    expect(upgradeLegacyEnvelopeBody({ a: 1, [oldWith]: false, [oldCategory]: 'x' })).toEqual({ a: 1, withSeals: false, sealCategory: 'x' });
    expect(upgradeLegacyEnvelopeBody({ withSeals: true, [oldWith]: false })).toEqual({ withSeals: true });
    expect(upgradeLegacyEnvelopeBody(null)).toBeNull();
  });

  it('can still create a sealed envelope with the old field names', async () => {
    const utxo = addSenderUtxo(t.provider, 200_000n, 0);
    // A pre-rename bundle sends only the old names.
    const body = createBody({ shareCount: 2, totalSats: 10_000 }) as Record<string, unknown>;
    delete body.withSeals;
    delete body.sealCategory;
    const r = await t
      .http()
      .post('/envelopes')
      .send({ ...body, [oldName('withSeals')]: true, [oldName('sealCategory')]: utxo.txid });
    expect(r.status).toBe(201);
    expect((r.body as CreateEnvelopeResponse).fundingTemplate.some((o) => o.token?.category === utxo.txid)).toBe(true);
  });

  it('still finds `seal` under the old key in the envelope view and the broadcast result', async () => {
    const env = await fundedEnvelope(t, { withSeals: true, shareCount: 2, totalSats: 10_000 });
    const view = (await t.http().get(`/envelopes/${env.id}`)).body;
    expect(view.seal).toBeTruthy();
    expect(view[LEGACY_RESPONSE_KEY]).toEqual(view.seal);

    const a = (await claimReq(t, env.id, { recipientAddress: addressOf('legacy') })).body as ClaimApproval;
    const b = (await broadcastReq(t, a)).body;
    expect(b.seal.imageUrl).toMatch(/\/seals\//);
    expect(b[LEGACY_RESPONSE_KEY]).toEqual(b.seal);
  });
});
