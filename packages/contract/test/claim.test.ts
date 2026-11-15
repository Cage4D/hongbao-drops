import { describe, expect, it } from 'vitest';
import { MockNetworkProvider, randomNFT, randomUtxo } from 'cashscript';
import { binToHex, hash160, secp256k1, sha256 } from '@bitauth/libauth';
import { buildClaimTx, gateMessage, hongbaoContract, signGateApproval } from '../src/index.js';

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
