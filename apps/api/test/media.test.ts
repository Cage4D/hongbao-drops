// Phase 6: link-preview cards, seal artwork, BCMR registries.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { binToHex, sha256 } from '@bitauth/libauth';
import type { CreateEnvelopeResponse } from '@hongbao/shared';
import { fundedEnvelope, makeApp, resetDb } from './helpers.js';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => (t = await makeApp()));
afterAll(async () => t.app.close());
beforeEach(async () => resetDb(t.db));

const binary = (req: ReturnType<ReturnType<typeof t.http>['get']>) =>
  req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
/** PNG width/height from the IHDR chunk. */
const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const PNG_SIG = '89504e470d0a1a0a';

describe('GET /og/:id.png', () => {
  it.each(['classic-red', 'gold', 'christmas', 'lunar'])('renders a 1200×630 PNG card for theme %s', async (theme) => {
    const env = await fundedEnvelope(t, { theme, message: theme === 'lunar' ? '新年快乐！恭喜发财' : 'Happy holidays' });
    const r = await binary(t.http().get(`/og/${env.slug}.png`));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toMatch(/max-age=60/);
    const body = r.body as Buffer;
    expect(body.subarray(0, 8).toString('hex')).toBe(PNG_SIG);
    expect(pngSize(body)).toEqual({ w: 1200, h: 630 });
  });

  it('works by envelope id too, and 404s unknown envelopes', async () => {
    const env = await fundedEnvelope(t);
    expect((await binary(t.http().get(`/og/${env.id}.png`))).status).toBe(200);
    expect((await t.http().get('/og/nope.png')).status).toBe(404);
    expect((await t.http().get(`/og/${env.slug}.jpg`)).status).toBe(404);
  });
});

describe('seals', () => {
  let env: CreateEnvelopeResponse;
  let category: string;
  let commitment: string;
  beforeEach(async () => {
    env = await fundedEnvelope(t, { withSeals: true, theme: 'christmas' });
    category = env.fundingTemplate[1]!.token!.category;
    commitment = env.fundingTemplate[1]!.token!.nftCommitment;
  });

  it('serves each share seal as SVG and 512×512 PNG, cached forever', async () => {
    const svg = await binary(t.http().get(`/seals/${category}/${commitment}.svg`));
    expect(svg.status).toBe(200);
    expect(svg.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(svg.headers['cache-control']).toMatch(/immutable/);
    expect((svg.body as Buffer).toString()).toContain(`#${env.envelopeSeq}-1`);
    const png = await binary(t.http().get(`/seals/${category}/${commitment}.png`));
    expect(pngSize(png.body as Buffer)).toEqual({ w: 512, h: 512 });
    expect((await binary(t.http().get(`/seals/${category}/collection.png`))).status).toBe(200);
  });

  it('404s commitments that are not this envelope\'s shares', async () => {
    const seqHex = commitment.slice(0, 8);
    for (const bad of [`${seqHex}00`, `${seqHex}04`, `ffffffff01`, 'zz', 'collection.gif']) {
      expect((await t.http().get(`/seals/${category}/${bad.includes('.') ? bad : `${bad}.svg`}`)).status).toBe(404);
    }
    expect((await t.http().get(`/seals/${'00'.repeat(32)}/collection.svg`)).status).toBe(404);
  });
});

describe('GET /bcmr/:category.json', () => {
  it('serves the exact registry bytes whose sha256 is committed on-chain, and its URIs resolve', async () => {
    const env = await fundedEnvelope(t, { withSeals: true, shareCount: 2, totalSats: 10_000 });
    const category = env.fundingTemplate[1]!.token!.category;
    const r = await t.http().get(`/bcmr/${category}.json`).buffer(true).parse((res, cb) => {
      let d = '';
      res.on('data', (c: Buffer) => (d += c.toString()));
      res.on('end', () => cb(null, d));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(binToHex(sha256.hash(new TextEncoder().encode(r.body as string)))).toBe(env.bcmr!.hash);

    const registry = JSON.parse(r.body as string);
    const snapshot = Object.values(registry.identities[category])[0] as {
      token: { category: string; nfts: { parse: { types: Record<string, { name: string; uris: { icon: string } }> } } };
      uris: { icon: string };
    };
    expect(snapshot.token.category).toBe(category);
    const types = snapshot.token.nfts.parse.types;
    expect(Object.keys(types)).toHaveLength(2);
    for (const uri of [snapshot.uris.icon, ...Object.values(types).map((ty) => ty.uris.icon)]) {
      expect(uri).toMatch(/\.png$/);
      const path = uri.replace('https://api.hongbao.test', '');
      expect((await t.http().get(path)).status).toBe(200);
    }
  });

  it('404s unknown categories and malformed names', async () => {
    expect((await t.http().get(`/bcmr/${'ab'.repeat(32)}.json`)).status).toBe(404);
    expect((await t.http().get('/bcmr/nope.json')).status).toBe(404);
  });
});
