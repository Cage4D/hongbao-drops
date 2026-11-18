// Spec §5.4 test matrix for Hongbao.cash, on MockNetworkProvider (validates against the 2026 VM).
// Every negative case also asserts WHICH require() failed, so a test can't pass for the wrong reason.
import { describe, expect, it } from 'vitest';
import {
  MockNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  randomNFT,
  randomUtxo,
  type TokenDetails,
  type SpendableUtxo,
} from 'cashscript';
import { hash160, secp256k1, sha256 } from '@bitauth/libauth';
import {
  DEFAULT_MAX_FEE,
  gateMessage,
  hongbaoContract,
  type HongbaoContract,
  signGateApproval,
  sealCommitment,
} from '../src/index.js';

// ---------- fixtures ----------
const key = (label: string) => sha256.hash(new TextEncoder().encode(`hongbao-test-${label}`));
const pub = (priv: Uint8Array) => secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
const p2pkh = (pk: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pk), 0x88, 0xac]);

const linkPriv = key('link');
const gatePriv = key('gate');
const otherPriv = key('other');
const sender = p2pkh(pub(key('sender')));
const claimer = p2pkh(pub(key('claimer')));
const attacker = p2pkh(pub(key('attacker')));

const EXPIRY = 1_800_000_000; // 2027-01-15
const MAX_FEE = DEFAULT_MAX_FEE; // 1,000 sats
const SHARE = 20_000n;

function setup(overrides: { linkPk?: Uint8Array; refund?: Uint8Array } = {}) {
  const provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
  const contract = hongbaoContract(
    {
      linkPk: overrides.linkPk ?? pub(linkPriv),
      gatePk: pub(gatePriv),
      refundLockingBytecode: overrides.refund ?? sender,
      expiry: EXPIRY,
      maxFee: MAX_FEE,
    },
    provider,
  );
  return { provider, contract };
}

let sealSeq = 0;
/** An immutable seal NFT like the funding tx mints. */
const seal = (shareIndex = 1): TokenDetails =>
  randomNFT({
    nft: { capability: 'none', commitment: Buffer.from(sealCommitment(++sealSeq, shareIndex)).toString('hex') },
  });

function addShare(provider: MockNetworkProvider, contract: HongbaoContract, token?: TokenDetails) {
  return provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: SHARE, ...(token && { token }) }));
}

const approve = (share: SpendableUtxo, recipient: Uint8Array, priv = gatePriv) =>
  signGateApproval(priv, gateMessage(recipient, share.txid, share.vout));

/** Assert rejection by the VM at a specific require() in Hongbao.cash. */
async function expectFail(p: Promise<unknown>, failingRequire: string) {
  await expect(p).rejects.toThrow(`Failing statement: require(${failingRequire}`);
}

// ---------- claim ----------
describe('claim', () => {
  it('#1 valid claim, BCH-only share', async () => {
    const { provider, contract } = setup();
    const share = addShare(provider, contract);
    await new TransactionBuilder({ provider })
      .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer)))
      .addOutput({ to: claimer, amount: SHARE - 500n })
      .send();
    expect(await provider.getUtxosForLockingBytecode(claimer)).toHaveLength(1);
  });

  it('#2 valid claim, share with seal NFT (claimer receives the seal)', async () => {
    const { provider, contract } = setup();
    const token = seal();
    const share = addShare(provider, contract, token);
    await new TransactionBuilder({ provider })
      .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer)))
      .addOutput({ to: claimer, amount: SHARE - 500n, token })
      .send();
    const [received] = await provider.getUtxosForLockingBytecode(claimer);
    expect(received?.token?.nft?.commitment).toBe(token.nft?.commitment);
  });

  it('#2b fee of exactly maxFee is allowed', async () => {
    const { provider, contract } = setup();
    const share = addShare(provider, contract);
    await new TransactionBuilder({ provider })
      .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer)))
      .addOutput({ to: claimer, amount: SHARE - MAX_FEE })
      .send();
  });

  it('#3 wrong link key ❌', async () => {
    const { provider, contract } = setup();
    const share = addShare(provider, contract);
    await expectFail(
      new TransactionBuilder({ provider })
        .addInput(share, contract.unlock.claim(new SignatureTemplate(otherPriv), approve(share, claimer)))
        .addOutput({ to: claimer, amount: SHARE - 500n })
        .send(),
      'checkSig(linkSig, linkPk)',
    );
  });

  it('#4 gate sig for a different recipient ❌ (link holder redirects an approval)', async () => {
    const { provider, contract } = setup();
    const share = addShare(provider, contract);
    await expectFail(
      new TransactionBuilder({ provider })
        .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer)))
        .addOutput({ to: attacker, amount: SHARE - 500n })
        .send(),
      'checkDataSig(gateSig',
    );
  });

  it('#4b approval signed by a key other than the gate ❌', async () => {
    const { provider, contract } = setup();
    const share = addShare(provider, contract);
    await expectFail(
      new TransactionBuilder({ provider })
        .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer, otherPriv)))
        .addOutput({ to: claimer, amount: SHARE - 500n })
        .send(),
      'checkDataSig(gateSig',
    );
  });

  it('#5 gate sig for a different share (replay) ❌', async () => {
    const { provider, contract } = setup();
    const shareA = addShare(provider, contract);
    const shareB = addShare(provider, contract);
    await expectFail(
      new TransactionBuilder({ provider })
        .addInput(shareB, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(shareA, claimer)))
        .addOutput({ to: claimer, amount: SHARE - 500n })
        .send(),
      'checkDataSig(gateSig',
    );
  });

  it('#6 fee > maxFee ❌', async () => {
    const { provider, contract } = setup();
    const share = addShare(provider, contract);
    await expectFail(
      new TransactionBuilder({ provider })
        .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer)))
        .addOutput({ to: claimer, amount: SHARE - MAX_FEE - 1n })
        .send(),
      'tx.outputs[0].value >= tx.inputs[0].value - maxFee',
    );
  });

  it('#7 claim with 2 outputs (skimming) ❌', async () => {
    const { provider, contract } = setup();
    const share = addShare(provider, contract);
    await expectFail(
      new TransactionBuilder({ provider })
        .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer)))
        .addOutput({ to: claimer, amount: SHARE - 2_000n })
        .addOutput({ to: attacker, amount: 1_000n })
        .send(),
      'tx.outputs.length == 1',
    );
  });

  it('#8 claim spending 2 shares in one tx ❌', async () => {
    const { provider, contract } = setup();
    const shareA = addShare(provider, contract);
    const shareB = addShare(provider, contract);
    await expectFail(
      new TransactionBuilder({ provider })
        .addInput(shareA, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(shareA, claimer)))
        .addInput(shareB, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(shareB, claimer)))
        .addOutput({ to: claimer, amount: 2n * SHARE - 1_000n })
        .send(),
      'tx.inputs.length == 1',
    );
  });

  describe('#9 claim that drops / changes the NFT ❌', () => {
    it('drops the seal (burn is consensus-legal, so only the contract stops it)', async () => {
      const { provider, contract } = setup();
      const share = addShare(provider, contract, seal());
      await expectFail(
        new TransactionBuilder({ provider })
          .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer)))
          .addOutput({ to: claimer, amount: SHARE - 500n })
          .send(),
        'tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory',
      );
    });

    it('adds a token to the claim output of a BCH-only share', async () => {
      // Only possible as a genesis, which needs input 0 to spend a vout-0 outpoint.
      const { provider, contract } = setup();
      const share = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: SHARE, vout: 0 }));
      const minted: TokenDetails = { category: share.txid, amount: 0n, nft: { capability: 'none', commitment: '01' } };
      await expectFail(
        new TransactionBuilder({ provider })
          .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer)))
          .addOutput({ to: claimer, amount: SHARE - 500n, token: minted })
          .send(),
        'tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory',
      );
    });

    it('changes the commitment (only legal for mutable NFTs, so a mutable share is used)', async () => {
      const { provider, contract } = setup();
      const token = randomNFT({ nft: { capability: 'mutable', commitment: '0100000001' } });
      const share = addShare(provider, contract, token);
      await expectFail(
        new TransactionBuilder({ provider })
          .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer)))
          .addOutput({
            to: claimer,
            amount: SHARE - 500n,
            token: { ...token, nft: { capability: 'mutable', commitment: '0100000002' } },
          })
          .send(),
        'tx.outputs[0].nftCommitment == tx.inputs[0].nftCommitment',
      );
    });

    it('changes the capability (mutable → none; tokenCategory carries the capability byte)', async () => {
      const { provider, contract } = setup();
      const token = randomNFT({ nft: { capability: 'mutable', commitment: '0100000001' } });
      const share = addShare(provider, contract, token);
      await expectFail(
        new TransactionBuilder({ provider })
          .addInput(share, contract.unlock.claim(new SignatureTemplate(linkPriv), approve(share, claimer)))
          .addOutput({
            to: claimer,
            amount: SHARE - 500n,
            token: { ...token, nft: { capability: 'none', commitment: '0100000001' } },
          })
          .send(),
        'tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory',
      );
    });
  });
});

// ---------- refundBatch ----------
function refundTx(
  provider: MockNetworkProvider,
  contract: HongbaoContract,
  shares: SpendableUtxo[],
  opts: { locktime?: number; to?: Uint8Array; fee?: bigint; outputs?: { amount: bigint; token?: TokenDetails }[] } = {},
) {
  const tb = new TransactionBuilder({ provider });
  for (const s of shares) tb.addInput(s, contract.unlock.refundBatch());
  const outputs = opts.outputs ?? shares.map((s) => ({ amount: s.satoshis - (opts.fee ?? 400n), token: s.token }));
  for (const o of outputs) tb.addOutput({ to: opts.to ?? sender, amount: o.amount, ...(o.token && { token: o.token }) });
  return tb.setLocktime(opts.locktime ?? EXPIRY);
}

describe('refundBatch', () => {
  it('#10 refund before expiry ❌', async () => {
    const { provider, contract } = setup();
    const share = addShare(provider, contract);
    await expectFail(refundTx(provider, contract, [share], { locktime: EXPIRY - 1 }).send(), 'tx.time >= expiry');
  });

  it('#11 batch refund of 1 share after expiry', async () => {
    const { provider, contract } = setup();
    const share = addShare(provider, contract);
    await refundTx(provider, contract, [share]).send();
    expect(await provider.getUtxosForLockingBytecode(sender)).toHaveLength(1);
  });

  it('#12 batch refund of 5 shares with NFTs after expiry (each seal back on its own output)', async () => {
    const { provider, contract } = setup();
    const shares = [1, 2, 3, 4, 5].map((i) => addShare(provider, contract, seal(i)));
    await refundTx(provider, contract, shares).send();
    const refunded = await provider.getUtxosForLockingBytecode(sender);
    expect(refunded.map((u) => u.token?.nft?.commitment).sort()).toEqual(
      shares.map((s) => s.token?.nft?.commitment).sort(),
    );
  });

  it('#12b batch refund of 20 shares (keeper cap) passes VM limits', async () => {
    const { provider, contract } = setup();
    const shares = Array.from({ length: 20 }, (_, i) => addShare(provider, contract, seal((i % 10) + 1)));
    await refundTx(provider, contract, shares).send();
  }, 60_000); // mock VM debugs every input: ~15 s

  it('#13 batch refund to any other address ❌', async () => {
    const { provider, contract } = setup();
    const shares = [addShare(provider, contract), addShare(provider, contract)];
    await expectFail(
      refundTx(provider, contract, shares, { to: attacker }).send(),
      'tx.outputs[i].lockingBytecode == refundLockingBytecode',
    );
  });

  it('#14 batch refund mixing in an input from another contract ❌', async () => {
    const { provider, contract } = setup();
    // Same sender & expiry, different link key → different contract (different locking bytecode).
    const other = setup({ linkPk: pub(otherPriv) });
    const ours = addShare(provider, contract);
    const theirs = provider.addUtxo(other.contract.tokenAddress, randomUtxo({ satoshis: SHARE }));
    const tb = new TransactionBuilder({ provider })
      .addInput(ours, contract.unlock.refundBatch())
      .addInput(theirs, other.contract.unlock.refundBatch())
      .addOutput({ to: sender, amount: SHARE - 400n })
      .addOutput({ to: sender, amount: SHARE - 400n })
      .setLocktime(EXPIRY);
    await expectFail(tb.send(), 'tx.inputs[i].lockingBytecode == self');
  });

  describe('#15 fewer outputs than inputs / reordered NFTs ❌', () => {
    it('fewer outputs than inputs (merging shares)', async () => {
      const { provider, contract } = setup();
      const shares = [addShare(provider, contract), addShare(provider, contract)];
      await expectFail(
        refundTx(provider, contract, shares, { outputs: [{ amount: 2n * SHARE - 800n }] }).send(),
        'tx.outputs.length == inputCount',
      );
    });

    it('seals swapped between outputs', async () => {
      const { provider, contract } = setup();
      const shares = [addShare(provider, contract, seal(1)), addShare(provider, contract, seal(2))];
      await expectFail(
        refundTx(provider, contract, shares, {
          outputs: [
            { amount: SHARE - 400n, token: shares[1]!.token },
            { amount: SHARE - 400n, token: shares[0]!.token },
          ],
        }).send(),
        'tx.outputs[i].tokenCategory == tx.inputs[i].tokenCategory',
      );
    });
  });

  it('#16 batch refund with fee > maxFee ❌', async () => {
    const { provider, contract } = setup();
    const shares = [addShare(provider, contract), addShare(provider, contract)];
    await expectFail(
      refundTx(provider, contract, shares, { fee: MAX_FEE + 1n }).send(),
      'tx.outputs[i].value >= tx.inputs[i].value - maxFee',
    );
  });
});
