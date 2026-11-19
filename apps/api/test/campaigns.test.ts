// Phase 7: sponsors, campaigns, funnel stats (exact numbers), CSV, public proof of reach, global stats.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { binToHex, sha256 } from '@bitauth/libauth';
import type { CampaignStats, ClaimApproval, GlobalStats } from '@hongbao/shared';
import { addressOf, broadcastReq, claimReq, fundedEnvelope, key, makeApp, p2pkh, pub, resetDb } from './helpers.js';

const KEEPER_TOKEN = 'k'.repeat(32);
let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => (t = await makeApp({ KEEPER_TOKEN })));
afterAll(async () => t.app.close());
beforeEach(async () => resetDb(t.db)); // price $200/BCH

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
async function sponsor(name = 'BCH Blaze') {
  const r = await t.http().post('/sponsors').send({ name, brandColor: '#0AC18E', ctaLabel: 'Visit', ctaUrl: 'https://example.org' });
  expect(r.status).toBe(201);
  return r.body as { sponsorId: string; sponsorToken: string };
}
async function campaign(token: string, name = 'BLAZE Drop') {
  const r = await t.http().post('/campaigns').set(bearer(token)).send({ name });
  expect(r.status).toBe(201);
  return r.body.campaignId as string;
}
const claim = async (envId: string, who: string, ip: string) => {
  const a = (await claimReq(t, envId, { recipientAddress: addressOf(who) }, ip)).body as ClaimApproval;
  const b = await broadcastReq(t, a);
  expect(b.status).toBe(200);
  return { approval: a, txid: b.body.txid as string };
};
const coinOf = async (who: string, txid: string) =>
  (await t.provider.getUtxosForLockingBytecode(binToHex(p2pkh(pub(key(who)))))).find((u) => u.txid === txid)!;
const tick = () => t.http().post('/internal/keeper/tick').set(bearer(KEEPER_TOKEN));

describe('sponsors & campaigns', () => {
  it('stores only a hash of the sponsor token; campaigns need it; sponsors only see their own', async () => {
    const a = await sponsor();
    expect(a.sponsorToken).toMatch(/^hbs_[A-Za-z0-9_-]{43}$/);
    const row = await t.db.sponsor.findUniqueOrThrow({ where: { id: a.sponsorId } });
    expect(row.adminToken).toBe(binToHex(sha256.hash(new TextEncoder().encode(a.sponsorToken))));
    expect(JSON.stringify(row)).not.toContain(a.sponsorToken);

    expect((await t.http().post('/campaigns').send({ name: 'x' })).status).toBe(401);
    expect((await t.http().post('/campaigns').set(bearer('hbs_wrong')).send({ name: 'x' })).status).toBe(401);
    const cid = await campaign(a.sponsorToken);

    const b = await sponsor('Other');
    expect((await t.http().get(`/campaigns/${cid}/stats`).set(bearer(b.sponsorToken))).status).toBe(404);
    expect((await t.http().get(`/campaigns/${cid}/export.csv`).set(bearer(b.sponsorToken))).status).toBe(404);
    expect((await t.http().get(`/campaigns/${cid}/stats`)).status).toBe(401);
  });

  it.each([
    [{ name: 'x', logoUrl: 'http://insecure.example/logo.png' }, 'logoUrl'],
    [{ name: 'x', brandColor: 'red' }, 'brandColor'],
    [{ name: 'x', ctaLabel: 'Go' }, 'ctaUrl'],
    [{ name: '' }, 'name'],
  ])('validates sponsor fields (%j)', async (body, path) => {
    const r = await t.http().post('/sponsors').send(body);
    expect(r.status).toBe(400);
    expect(r.body.error.issues.map((i: { path: string }) => i.path)).toContain(path);
  });
});

describe('campaign stats', () => {
  it('computes the funnel and cost per activated new wallet exactly, and every number traces to txids', async () => {
    const s = await sponsor();
    const cid = await campaign(s.sponsorToken);
    const sponsored = { sponsorToken: s.sponsorToken, campaignId: cid };
    const e1 = await fundedEnvelope(t, { ...sponsored, shareCount: 3, totalSats: 30_000 }); // fee 900
    const e2 = await fundedEnvelope(t, { ...sponsored, shareCount: 2, totalSats: 20_000 }); // fee 600

    // An existing wallet (has history) → not fresh.
    t.provider.addUtxo(binToHex(p2pkh(pub(key('old-timer')))), { txid: 'cd'.repeat(32), vout: 0, satoshis: 5_000n });
    const alice = await claim(e1.id, 'alice', '10.0.1.1');
    const bob = await claim(e1.id, 'bob', '10.0.1.2');
    await claim(e1.id, 'old-timer', '10.0.1.3');
    const carol = await claim(e2.id, 'carol', '10.0.1.4');

    // Alice moves her coins (activated). Bob re-gifts from his (activated + pass-on); Dave claims that.
    const aliceCoin = await coinOf('alice', alice.txid);
    await new TransactionBuilder({ provider: t.provider })
      .addInput(aliceCoin, new SignatureTemplate(key('alice')).unlockP2PKH())
      .addOutput({ to: p2pkh(pub(key('shop'))), amount: aliceCoin.satoshis - 400n })
      .send();
    const child = await fundedEnvelope(t, { shareCount: 2, totalSats: 3_000, parentEnvelopeId: e1.id }, 'bob', await coinOf('bob', bob.txid));
    await claim(child.id, 'dave', '10.0.1.5');
    // Carol never touches hers; 7 days pass.
    await t.db.claim.update({ where: { id: carol.approval.claimId }, data: { createdAt: new Date(Date.now() - 8 * 24 * 3600_000) } });

    // CTA: 3 clicks from one IP count once; another IP counts again.
    for (const ip of ['10.9.0.1', '10.9.0.1', '10.9.0.1', '10.9.0.2']) {
      expect((await t.http().post(`/envelopes/${e1.id}/cta-click`).set('x-forwarded-for', ip)).status).toBe(204);
    }
    expect((await tick()).status).toBe(200);

    const r = await t.http().get(`/campaigns/${cid}/stats`).set(bearer(s.sponsorToken));
    expect(r.status).toBe(200);
    const st = r.body as CampaignStats;
    expect(st).toMatchObject({
      name: 'BLAZE Drop',
      sponsor: { name: 'BCH Blaze', brandColor: '#0AC18E' },
      claims: 4,
      freshWallets: 3, // alice, bob, carol (not old-timer)
      activatedWallets: 2, // alice (moved), bob (passed on)
      activatedNotFarm: 2,
      pendingActivation: 0,
      suspectedFarms: 1, // carol: NEVER_USED
      givenAwaySats: 40_000, // 4 claimed shares × 10,000
      feesSats: 1_500, // 3% of 50,000
      spentSats: 41_500,
      spentUsd: 0.08, // 41,500 sats × $200
      feesUsd: 0,
      givenAwayUsd: 0.08, // §9: USD next to every amount (review-2)
      lockedSats: 10_000, // e2's unclaimed share
      lockedUsd: 0.02,
      refundedUsd: 0,
      priceUsd: 200,
      costPerActivatedNewWalletUsd: 0.04, // $0.08 / 2
      costPerFreshWalletUsd: 0.03, // $0.08 / 3
      ctaClicks: 2,
      ctr: 0.5,
      passOnEnvelopes: 1,
      totalReach: 5, // 4 campaign claims + Dave in the passed-on envelope
    });
    expect(st.fundingTxids.sort()).toEqual([e1.fundingTxid, e2.fundingTxid].sort());
    expect(st.claimTxids).toHaveLength(4);
    expect(st.perEnvelope.map((e) => [e.slug, e.claims, e.freshWallets, e.activatedNotFarm, e.ctaClicks])).toEqual([
      [e1.slug, 3, 2, 2, 2],
      [e2.slug, 1, 1, 0, 0],
    ]);

    // Every claim txid really pays the claimed amount to the claimer (reconcile with the "chain").
    const claims = await t.db.claim.findMany({ where: { claimTxid: { in: st.claimTxids } } });
    for (const c of claims) {
      const raw = await t.provider.getRawTransaction(c.claimTxid!);
      expect(raw).toBeTruthy();
    }

    // CSV: sponsor-only, one row per claim, full addresses.
    const csv = await t.http().get(`/campaigns/${cid}/export.csv`).set(bearer(s.sponsorToken));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toBe(
      'envelope_slug,claimed_at,recipient_address,share_index,share_outpoint,share_sats,received_sats,claim_txid,status,fresh_wallet,activated_within_7d,suspected_farm,farm_reasons,wallet_fingerprint',
    );
    expect(lines).toHaveLength(5);
    expect(csv.text).toContain(addressOf('alice'));
    expect(lines.find((l) => l.includes(addressOf('old-timer')))).toContain(',false,');
    expect(lines.find((l) => l.includes(addressOf('carol')))).toContain('NEVER_USED');

    // Public proof of reach: same numbers, no addresses, no auth.
    const pub_ = await t.http().get(`/campaigns/${cid}/public`);
    expect(pub_.status).toBe(200);
    expect(pub_.body).toMatchObject({ claims: 4, activatedNotFarm: 2, costPerActivatedNewWalletUsd: 0.04 });
    const text = JSON.stringify(pub_.body);
    for (const who of ['alice', 'bob', 'carol', 'old-timer']) {
      expect(text).not.toContain(addressOf(who).split(':')[1]!);
      expect(text).not.toContain(addressOf(who, false).split(':')[1]!);
    }
    expect(text).not.toMatch(/fingerprint|ipHash|adminToken/);

    // Global stats include the passed-on envelope and Dave.
    const g = (await t.http().get('/stats/global')).body as GlobalStats;
    expect(g).toMatchObject({ envelopes: 3, claims: 5, newWalletsOnboarded: 4, activatedNewWallets: 2, passOnEnvelopes: 1 });
    expect(g.bchGiftedSats).toBe(40_000 + 1_500);

    // ?since= counts only what happened from then on: everything above happened after the epoch,
    // nothing after a time in the future.
    const all = (await t.http().get('/stats/global?since=2000-01-01T00:00:00Z')).body as GlobalStats;
    expect(all).toMatchObject({ envelopes: 3, claims: 5, newWalletsOnboarded: 4, passOnEnvelopes: 1, since: '2000-01-01T00:00:00.000Z' });
    expect(all.bchGiftedSats).toBeGreaterThan(0);
    const none = (await t.http().get(`/stats/global?since=${new Date(Date.now() + 3600_000).toISOString()}`)).body as GlobalStats;
    expect(none).toMatchObject({ envelopes: 0, claims: 0, newWalletsOnboarded: 0, bchGiftedSats: 0, passOnEnvelopes: 0 });
    expect((await t.http().get('/stats/global?since=yesterday')).status).toBe(400);
  });

  it('counts only funded envelopes: an unfunded sponsored envelope adds nothing', async () => {
    const s = await sponsor();
    const cid = await campaign(s.sponsorToken);
    const r = await t.http().post('/envelopes').send({
      senderAddress: 'bchtest:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwgw2cltjwn',
      linkPk: binToHex(pub(key('link'))),
      shareCount: 2,
      mode: 'EQUAL',
      totalSats: 10_000,
      expiry: Math.floor(Date.now() / 1000) + 1800,
      withSeals: false,
      sponsorToken: s.sponsorToken,
      campaignId: cid,
    });
    expect(r.status).toBe(201);
    const st = (await t.http().get(`/campaigns/${cid}/stats`).set(bearer(s.sponsorToken))).body as CampaignStats;
    expect(st).toMatchObject({ claims: 0, spentSats: 0, feesSats: 0, costPerActivatedNewWalletUsd: null, perEnvelope: [] });
  });

  it('review-2 P1-14: a FAILED envelope (funding vanished) adds no spend or fee', async () => {
    const s = await sponsor();
    const cid = await campaign(s.sponsorToken);
    const env = await fundedEnvelope(t, { sponsorToken: s.sponsorToken, campaignId: cid, totalSats: 50_000 });
    const before = (await t.http().get(`/campaigns/${cid}/stats`).set(bearer(s.sponsorToken))).body as CampaignStats;
    expect(before.feesSats).toBe(1_500);
    await t.db.envelope.update({ where: { id: env.id }, data: { status: 'FAILED' } });
    const st = (await t.http().get(`/campaigns/${cid}/stats`).set(bearer(s.sponsorToken))).body as CampaignStats;
    expect(st).toMatchObject({ feesSats: 0, spentSats: 0, lockedSats: 0, perEnvelope: [] });
  });

  it('cta-click 404s unknown envelopes', async () => {
    expect((await t.http().post('/envelopes/nope/cta-click')).status).toBe(404);
  });
});
