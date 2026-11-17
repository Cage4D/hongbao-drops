// planRefund (review-2 P1-1): shares at the API's minimum sizes must be refundable. The old
// dust + maxFee threshold (546 + 1,000) stranded every no-stamp share under 1,546 sats.
import { describe, expect, it } from 'vitest';
import { MockNetworkProvider, randomNFT, randomUtxo, type Utxo } from 'cashscript';
import { binToHex, hash160, secp256k1, sha256 } from '@bitauth/libauth';
import { MAX_REFUND_BATCH, MIN_SHARE_SATS_NO_STAMP, MIN_SHARE_SATS_WITH_STAMP, hongbaoContract, planRefund } from '../src/index.js';

const key = (l: string) => sha256.hash(new TextEncoder().encode(`hongbao-refundtx-${l}`));
const pub = (k: Uint8Array) => secp256k1.derivePublicKeyCompressed(k) as Uint8Array;
const p2pkh = (pk: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pk), 0x88, 0xac]);
const EXPIRY = 1_800_000_000;

function setup(coins: { sats: bigint; stamp?: boolean }[]) {
  const provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
  const refund = p2pkh(pub(key('sender')));
  const contract = hongbaoContract({ linkPk: pub(key('link')), gatePk: pub(key('gate')), refundLockingBytecode: refund, expiry: EXPIRY }, provider);
  const utxos: Utxo[] = coins.map((c, i) =>
    provider.addUtxo(
      contract.tokenAddress,
      randomUtxo({
        satoshis: c.sats,
        ...(c.stamp && { token: randomNFT({ nft: { capability: 'none', commitment: `01000000${(i + 1).toString(16).padStart(2, '0')}` } }) }),
      }),
    ),
  );
  const plan = () => planRefund({ contract, utxos, refundLockingBytecode: binToHex(refund), expiry: EXPIRY, maxFee: 1000n });
  return { provider, utxos, plan };
}

describe('planRefund (review-2 P1-1)', () => {
  it('refunds no-stamp shares of exactly MIN_SHARE_SATS_NO_STAMP (1,500)', async () => {
    const { provider, plan } = setup([{ sats: MIN_SHARE_SATS_NO_STAMP }, { sats: MIN_SHARE_SATS_NO_STAMP }, { sats: MIN_SHARE_SATS_NO_STAMP }]);
    const p = plan()!;
    expect(p.batch).toHaveLength(3);
    expect(p.dust).toHaveLength(0);
    expect(p.feePerInput).toBeLessThan(400n); // the real fee, not maxFee
    await provider.sendRawTransaction(p.hex); // the mock VM runs refundBatch
  });

  it('refunds stamped shares of exactly MIN_SHARE_SATS_WITH_STAMP (2,000)', async () => {
    const { provider, plan } = setup([{ sats: MIN_SHARE_SATS_WITH_STAMP, stamp: true }, { sats: MIN_SHARE_SATS_WITH_STAMP, stamp: true }]);
    const p = plan()!;
    expect(p.batch).toHaveLength(2);
    await provider.sendRawTransaction(p.hex);
  });

  it('leaves a coin that cannot cover its fee behind and still refunds the rest', async () => {
    const { provider, utxos, plan } = setup([{ sats: 10_000n }, { sats: 700n }, { sats: 10_000n }, { sats: 300n }]);
    const p = plan()!;
    expect(p.batch.map((u) => u.satoshis)).toEqual([10_000n, 10_000n]);
    expect(new Set(p.dust)).toEqual(new Set([utxos[1], utxos[3]]));
    await provider.sendRawTransaction(p.hex);
  });

  it('returns null when nothing can be refunded', () => {
    // ~350 sat fee for a 1-input refund: 800 − 350 < 546 dust. (900 would still refund.)
    expect(setup([{ sats: 800n }]).plan()).toBeNull();
    expect(setup([]).plan()).toBeNull();
  });

  it(`batches at most ${MAX_REFUND_BATCH} coins and reports the rest as remaining`, async () => {
    const { provider, plan } = setup(Array.from({ length: MAX_REFUND_BATCH + 3 }, () => ({ sats: MIN_SHARE_SATS_NO_STAMP })));
    const p = plan()!;
    expect(p.batch).toHaveLength(MAX_REFUND_BATCH);
    expect(p.remaining).toHaveLength(3);
    await provider.sendRawTransaction(p.hex);
  });
});
