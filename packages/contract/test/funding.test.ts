// Funding-tx layout + full lifecycle (fund → claim → batch refund) on the mock network.
import { describe, expect, it } from 'vitest';
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo } from 'cashscript';
import { binToHex, hash160, hexToBin, secp256k1, sha256 } from '@bitauth/libauth';
import {
  IDENTITY_OUTPUT_SATS,
  bcmrOpReturn,
  bcmrRegistryHash,
  equalSplit,
  fundingOutputs,
  gateMessage,
  hongbaoContract,
  luckySplit,
  shareOutputIndex,
  signGateApproval,
} from '../src/index.js';

const key = (l: string) => sha256.hash(new TextEncoder().encode(`hongbao-funding-${l}`));
const pub = (k: Uint8Array) => secp256k1.derivePublicKeyCompressed(k) as Uint8Array;
const p2pkh = (pk: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pk), 0x88, 0xac]);

const senderPriv = key('sender');
const sender = p2pkh(pub(senderPriv));
const treasury = p2pkh(pub(key('treasury')));
const claimer = p2pkh(pub(key('claimer')));
const linkPriv = key('link');
const gatePriv = key('gate');
const EXPIRY = 1_800_000_000;

function setup() {
  const provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
  const contract = hongbaoContract(
    { linkPk: pub(linkPriv), gatePk: pub(gatePriv), refundLockingBytecode: sender, expiry: EXPIRY },
    provider,
  );
  return { provider, contract };
}

const registry = new TextEncoder().encode('{"$schema":"https://cashtokens.org/bcmr-v2.schema.json"}');
const bcmr = { registryHash: bcmrRegistryHash(registry), uris: ['api.example/bcmr/x.json'] };

describe('bcmrOpReturn', () => {
  it('is OP_RETURN <BCMR> <hash> <uri>', () => {
    const hex = binToHex(bcmrOpReturn(new Uint8Array(32).fill(0xab), ['a.b/c']));
    expect(hex).toBe('6a' + '0442434d52' + '20' + 'ab'.repeat(32) + '05' + binToHex(new TextEncoder().encode('a.b/c')));
  });
});

describe('splits', () => {
  it('equalSplit sums exactly', () => {
    expect(equalSplit(10_001n, 3)).toEqual([3_334n, 3_334n, 3_333n]);
  });
  it('luckySplit sums exactly and respects the minimum', () => {
    for (let run = 0; run < 50; run++) {
      const s = luckySplit(50_000n, 7, 2_000n);
      expect(s.reduce((a, b) => a + b, 0n)).toBe(50_000n);
      expect(s.every((x) => x >= 2_000n)).toBe(true);
    }
  });
});

describe('fundingOutputs', () => {
  it('rejects shares below the minimum', () => {
    const { contract } = setup();
    expect(() => fundingOutputs({ contract, shareAmounts: [1_499n] })).toThrow(/minimum/);
  });

  it('BCH-only layout: shares first, then sponsor fee', () => {
    const { contract } = setup();
    const outs = fundingOutputs({
      contract,
      shareAmounts: [5_000n, 5_000n],
      sponsorFee: { lockingBytecode: treasury, amount: 300n },
    });
    expect(outs.map((o) => o.amount)).toEqual([5_000n, 5_000n, 300n]);
    expect(outs.every((o) => !o.token)).toBe(true);
  });
});

describe('lifecycle with seals (genesis in the funding tx)', () => {
  it('funds 3 seal-bearing shares, claims one, batch-refunds the other two', async () => {
    const { provider, contract } = setup();
    // Sender UTXO at vout 0 → its txid becomes the seal category.
    const funding = provider.addUtxo(binToHex(sender), randomUtxo({ satoshis: 100_000n, vout: 0 }));
    const category = funding.txid;
    const outputs = fundingOutputs({
      contract,
      shareAmounts: [10_000n, 10_000n, 10_000n],
      seals: { category, envelopeSeq: 7, identityLockingBytecode: treasury, bcmr },
    });
    const fundTx = new TransactionBuilder({ provider })
      .addInput(funding, new SignatureTemplate(senderPriv).unlockP2PKH())
      .addOutputs(outputs)
      .addOutput({ to: sender, amount: 100_000n - 30_000n - IDENTITY_OUTPUT_SATS - 1_000n });
    const sent = await fundTx.send();

    // Layout checks: identity first, then 3 seal-bearing shares, then BCMR OP_RETURN, then change.
    const shares = await provider.getUtxosForLockingBytecode(contract.lockingBytecode);
    expect(shares).toHaveLength(3);
    expect(shares.map((s) => s.vout).sort()).toEqual([1, 2, 3].map((i) => shareOutputIndex(i - 1, true)));
    expect(shares.map((s) => s.token?.nft?.commitment).sort()).toEqual(['0700000001', '0700000002', '0700000003']);
    expect(shares.every((s) => s.token?.category === category && s.token.nft?.capability === 'none')).toBe(true);
    expect(await provider.getUtxosForLockingBytecode(treasury)).toHaveLength(1);
    expect(sent.txid).toMatch(/^[0-9a-f]{64}$/);

    // Claim share #1.
    const share = shares.find((s) => s.vout === 1)!;
    const gateSig = signGateApproval(gatePriv, gateMessage(claimer, share.txid, share.vout));
    await new TransactionBuilder({ provider })
      .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), gateSig))
      .addOutput({ to: claimer, amount: share.satoshis - 700n, token: share.token })
      .send();
    const [caught] = await provider.getUtxosForLockingBytecode(claimer);
    expect(caught?.token?.nft?.commitment).toBe('0700000001');

    // Batch refund the remaining two after expiry.
    const left = await provider.getUtxosForLockingBytecode(contract.lockingBytecode);
    const refund = new TransactionBuilder({ provider });
    for (const s of left) refund.addInput(s, contract.unlock.refundBatch());
    for (const s of left) refund.addOutput({ to: sender, amount: s.satoshis - 600n, token: s.token });
    await refund.setLocktime(EXPIRY).send();
    const back = await provider.getUtxosForLockingBytecode(sender);
    expect(back.filter((u) => u.token).map((u) => u.token?.nft?.commitment).sort()).toEqual([
      '0700000002',
      '0700000003',
    ]);
  });

  it('genesis fails when input 0 is not a vout-0 outpoint (why the prep tx exists)', async () => {
    const { provider, contract } = setup();
    const funding = provider.addUtxo(binToHex(sender), randomUtxo({ satoshis: 100_000n, vout: 1 }));
    const outputs = fundingOutputs({
      contract,
      shareAmounts: [10_000n],
      seals: { category: funding.txid, envelopeSeq: 1, identityLockingBytecode: treasury, bcmr },
    });
    await expect(
      new TransactionBuilder({ provider })
        .addInput(funding, new SignatureTemplate(senderPriv).unlockP2PKH())
        .addOutputs(outputs)
        .send(),
    ).rejects.toThrow();
  });

  it('prep tx: a 1-in/1-out self-send creates a vout-0 outpoint usable for genesis', async () => {
    const { provider, contract } = setup();
    const odd = provider.addUtxo(binToHex(sender), randomUtxo({ satoshis: 100_000n, vout: 3 }));
    await new TransactionBuilder({ provider })
      .addInput(odd, new SignatureTemplate(senderPriv).unlockP2PKH())
      .addOutput({ to: sender, amount: 99_700n })
      .send();
    const [prepped] = await provider.getUtxosForLockingBytecode(sender);
    expect(prepped?.vout).toBe(0);
    await new TransactionBuilder({ provider })
      .addInput(prepped!, new SignatureTemplate(senderPriv).unlockP2PKH())
      .addOutputs(
        fundingOutputs({
          contract,
          shareAmounts: [10_000n],
          seals: { category: prepped!.txid, envelopeSeq: 1, identityLockingBytecode: treasury, bcmr },
        }),
      )
      .send();
    expect(hexToBin(prepped!.txid)).toHaveLength(32);
  });
});
