import { describe, expect, it } from 'vitest';
import { MockNetworkProvider, randomNFT, randomUtxo } from 'cashscript';
import { binToHex, hash160, secp256k1, sha256 } from '@bitauth/libauth';
import { MIN_SHARE_SATS_NO_SEAL, MIN_SHARE_SATS_WITH_SEAL, buildClaimTx, dustLimit, gateMessage, hongbaoContract, signGateApproval } from '../src/index.js';

const key = (l: string) => sha256.hash(new TextEncoder().encode(`hongbao-claimtx-${l}`));
const pub = (k: Uint8Array) => secp256k1.derivePublicKeyCompressed(k) as Uint8Array;
const p2pkh = (pk: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pk), 0x88, 0xac]);

describe('buildClaimTx', () => {
  it('builds a claim the contract accepts, paying 1 sat/B from the share', async () => {
    const provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
    const args = {
      linkPk: binToHex(pub(key('link'))),
      gatePk: binToHex(pub(key('gate'))),
      refundLockingBytecode: binToHex(p2pkh(pub(key('sender')))),
      expiry: 1_800_000_000,
      maxFee: 1000,
    };
    const contract = hongbaoContract(
      { linkPk: pub(key('link')), gatePk: pub(key('gate')), refundLockingBytecode: p2pkh(pub(key('sender'))), expiry: args.expiry },
      provider,
    );
    const token = randomNFT({ nft: { capability: 'none', commitment: '0100000001' } });
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 10_000n, token }));
    const recipient = p2pkh(pub(key('claimer')));
    const gateSig = binToHex(signGateApproval(key('gate'), gateMessage(recipient, utxo.txid, utxo.vout)));

    const { hex, fee, amount } = buildClaimTx({
      provider,
      constructorArgs: args,
      share: { outpointTxid: utxo.txid, outpointIndex: utxo.vout, sats: 10_000, tokenCategory: token.category, nftCommitment: '0100000001' },
      recipientLockingBytecode: binToHex(recipient),
      linkPrivateKey: key('link'),
      gateSig,
    });
    expect(fee).toBe(BigInt(hex.length / 2));
    expect(amount).toBe(10_000n - fee);
    await provider.sendRawTransaction(hex);
    const [got] = await provider.getUtxosForLockingBytecode(recipient);
    expect(got?.token?.nft?.commitment).toBe('0100000001');
  });
});

describe('minimum share sizes (review #4)', () => {
  const setup = async (sats: bigint, withToken: boolean) => {
    const provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
    const linkPk = pub(key('link'));
    const gatePk = pub(key('gate'));
    const refund = p2pkh(pub(key('sender')));
    const contract = hongbaoContract({ linkPk, gatePk, refundLockingBytecode: refund, expiry: 1_800_000_000 }, provider);
    const token = withToken ? randomNFT({ nft: { capability: 'none', commitment: '0100000001' } }) : undefined;
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: sats, ...(token && { token }) }));
    const recipient = p2pkh(pub(key('claimer')));
    const args = { linkPk: binToHex(linkPk), gatePk: binToHex(gatePk), refundLockingBytecode: binToHex(refund), expiry: 1_800_000_000, maxFee: 1000 };
    return {
      provider,
      run: () =>
        buildClaimTx({
          provider,
          constructorArgs: args,
          share: { outpointTxid: utxo.txid, outpointIndex: utxo.vout, sats, tokenCategory: token?.category ?? null, nftCommitment: token ? '0100000001' : null },
          recipientLockingBytecode: binToHex(recipient),
          linkPrivateKey: key('link'),
          gateSig: binToHex(signGateApproval(key('gate'), gateMessage(recipient, utxo.txid, utxo.vout))),
        }),
    };
  };

  it('claims a share of exactly MIN_SHARE_SATS_NO_SEAL (1,500)', async () => {
    const { provider, run } = await setup(MIN_SHARE_SATS_NO_SEAL, false);
    await provider.sendRawTransaction(run().hex);
  });

  it('claims a seal-bearing share of exactly MIN_SHARE_SATS_WITH_SEAL (2,000)', async () => {
    const { provider, run } = await setup(MIN_SHARE_SATS_WITH_SEAL, true);
    await provider.sendRawTransaction(run().hex);
  });

  it('refuses with a clear error below dust', async () => {
    const { run } = await setup(900n, false);
    expect(run).toThrow(/too small to claim/);
  });

  it('dustLimit matches the measured node values', () => {
    expect(dustLimit(25)).toBe(546n);
    expect(dustLimit(35)).toBe(576n);
    expect(dustLimit(25, randomNFT({ nft: { capability: 'none', commitment: '0100000001' } }))).toBe(666n);
  });
});
