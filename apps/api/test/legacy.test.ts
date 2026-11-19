// Seals minted before the "Hongbao Seals" rename keep their images (src/common/legacy.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_MEDIA_PREFIX } from '../src/common/legacy.js';
import { fundedEnvelope, makeApp, resetDb, testConfig } from './helpers.js';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => (t = await makeApp()));
afterAll(async () => t.app.close());
beforeEach(async () => resetDb(t.db));

describe('ENABLE_SEALS', () => {
  it('defaults to on, and can be turned off', () => {
    expect(testConfig().ENABLE_SEALS).toBe(true);
    expect(testConfig({ ENABLE_SEALS: 'false' }).ENABLE_SEALS).toBe(false);
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
      expect((await t.http().get(r.headers.location!)).status).toBe(200);
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
