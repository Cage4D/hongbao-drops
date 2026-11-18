// Phase 9: POST /wallets/activity (the site's "My activity" page for a connected wallet).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { binToHex } from '@bitauth/libauth';
import type { ClaimApproval, WalletActivityResponse } from '@hongbao/shared';
import { addressOf, broadcastReq, claimReq, createBody, fundedEnvelope, key, makeApp, p2pkh, pub, resetDb, sender } from './helpers.js';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => (t = await makeApp()));
afterAll(async () => t.app.close());
beforeEach(async () => resetDb(t.db));

const lb = (who: string) => binToHex(p2pkh(pub(key(who))));
const activity = (lockingBytecodes: string[]) => t.http().post('/wallets/activity').send({ lockingBytecodes });
const claim = async (envId: string, who: string) => {
  const a = (await claimReq(t, envId, { recipientAddress: addressOf(who) }, `10.9.0.${who.length}`)).body as ClaimApproval;
  const b = await broadcastReq(t, a);
  expect(b.status).toBe(200);
  return { txid: b.body.txid as string, amount: b.body.amountSats as number };
};
const claimedCoin = async (who: string, txid: string) => (await t.provider.getUtxosForLockingBytecode(lb(who))).find((u) => u.txid === txid)!;

describe('POST /wallets/activity', () => {
  it("lists a wallet's claims, its pass-on, and links the two", async () => {
    const root = await fundedEnvelope(t, { shareCount: 2, totalSats: 40_000, message: 'gong xi' });
    const alice = await claim(root.id, 'alice');
    const child = await fundedEnvelope(t, { shareCount: 2, totalSats: 16_000, parentEnvelopeId: root.id }, 'alice', await claimedCoin('alice', alice.txid));

    const r = await activity([lb('alice'), lb('nobody')]);
    expect(r.status).toBe(200);
    const body = r.body as WalletActivityResponse;
    expect(body.claimed).toHaveLength(1);
    expect(body.claimed[0]).toMatchObject({
      envelopeId: root.id,
      slug: root.slug,
      message: 'gong xi',
      amountSats: alice.amount,
      claimTxid: alice.txid,
      recipientAddress: addressOf('alice'),
      passedOn: { id: child.id, slug: child.slug },
    });
    expect(body.sent).toHaveLength(1);
    expect(body.sent[0]).toMatchObject({ id: child.id, parentEnvelopeId: root.id, status: 'ACTIVE', shares: { total: 2, claimed: 0, left: 2 } });
    expect(body.totals).toEqual({ sentCount: 1, sentSats: 16_000, claimedCount: 1, claimedSats: alice.amount, passOnCount: 1 });
  });

  it("lists the sender's drops with live share counts, and nothing for strangers", async () => {
    const env = await fundedEnvelope(t, { shareCount: 2, totalSats: 10_000 });
    await claim(env.id, 'bob');

    const mine = (await activity([binToHex(sender)])).body as WalletActivityResponse;
    expect(mine.sent.map((e) => [e.id, e.shares.claimed, e.shares.left, e.parentEnvelopeId])).toEqual([[env.id, 1, 1, null]]);
    expect(mine.claimed).toEqual([]);

    const stranger = (await activity([lb('carol')])).body as WalletActivityResponse;
    expect(stranger).toMatchObject({ sent: [], claimed: [], totals: { sentCount: 0, claimedCount: 0 } });
  });

  it('leaves out envelopes that were never sealed', async () => {
    const r = await t.http().post('/envelopes').send(createBody({ senderAddress: addressOf('dave', false) }));
    expect(r.status).toBe(201);
    expect(((await activity([lb('dave')])).body as WalletActivityResponse).sent).toEqual([]);
  });

  it.each([
    [{ lockingBytecodes: [] }],
    [{ lockingBytecodes: ['a914' + '00'.repeat(20) + '87'] }], // P2SH, not a wallet address
    [{ lockingBytecodes: Array(41).fill(binToHex(sender)) }],
    [{ addresses: ['bchtest:q…'] }],
  ])('rejects %o', async (body) => {
    const r = await t.http().post('/wallets/activity').send(body);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_REQUEST');
  });
});
