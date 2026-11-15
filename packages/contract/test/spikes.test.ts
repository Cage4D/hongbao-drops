// Phase 0 evidence for docs/findings.md §1. Not product tests — those arrive in Phase 1.
import { describe, expect, it } from 'vitest';
import { compileFile } from 'cashc';
import {
  Contract,
  MockNetworkProvider,
  TransactionBuilder,
  randomUtxo,
  randomNFT,
} from 'cashscript';
import {
  hexToBin,
  secp256k1,
  sha256,
  hash160,
  swapEndianness,
} from '@bitauth/libauth';

const artifact = compileFile(new URL('../spikes/semantics.cash', import.meta.url));
const priv = sha256.hash(new TextEncoder().encode('hongbao-phase0-spike'));
const pk = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
const p2pkh = (pub: Uint8Array) =>
  Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pub), 0x88, 0xac]);
const recipient = p2pkh(pk);

function setup() {
  const provider = new MockNetworkProvider();
  const contract = new Contract(artifact, [pk], { provider });
  return { provider, contract };
}

describe('§15.1 CashScript 0.14 semantics', () => {
  it('outpointTransactionHash is the txid in internal (reversed) byte order; index is 4-byte LE', async () => {
    const { provider, contract } = setup();
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ vout: 1, satoshis: 10_000n }));
    const expected = hexToBin(swapEndianness(utxo.txid) + '01000000');
    await new TransactionBuilder({ provider })
      .addInput(utxo, contract.unlock.outpoint(expected))
      .addOutput({ to: recipient, amount: 9_000n })
      .send();

    // The display-order txid does NOT match:
    const utxo2 = provider.addUtxo(contract.tokenAddress, randomUtxo({ vout: 1, satoshis: 10_000n }));
    const wrong = hexToBin(utxo2.txid + '01000000');
    await expect(
      new TransactionBuilder({ provider })
        .addInput(utxo2, contract.unlock.outpoint(wrong))
        .addOutput({ to: recipient, amount: 9_000n })
        .send(),
    ).rejects.toThrow(/failed/i);
  });

  it('token-less input → token-less output passes (empty category/commitment, amount 0)', async () => {
    const { provider, contract } = setup();
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 10_000n }));
    await new TransactionBuilder({ provider })
      .addInput(utxo, contract.unlock.tokenPassthrough())
      .addOutput({ to: recipient, amount: 9_000n })
      .send();
  });

  it('immutable NFT passes through unchanged', async () => {
    const { provider, contract } = setup();
    const token = randomNFT({ nft: { capability: 'none', commitment: 'aabbccdd01' } });
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 10_000n, token }));
    await new TransactionBuilder({ provider })
      .addInput(utxo, contract.unlock.tokenPassthrough())
      .addOutput({ to: recipient, amount: 9_000n, token })
      .send();
  });

  it('dropping the NFT fails', async () => {
    const { provider, contract } = setup();
    const token = randomNFT({ nft: { capability: 'none', commitment: 'aabbccdd01' } });
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 10_000n, token }));
    // Burning a token is legal at consensus level, so only the contract can stop it.
    await expect(
      new TransactionBuilder({ provider })
        .addInput(utxo, contract.unlock.tokenPassthrough())
        .addOutput({ to: recipient, amount: 9_000n })
        .send(),
    ).rejects.toThrow(/failed/i);
  });

  it('changing the commitment fails', async () => {
    const { provider, contract } = setup();
    const token = randomNFT({ nft: { capability: 'mutable', commitment: 'aabbccdd01' } });
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 10_000n, token }));
    // A mutable NFT may legally change its commitment at consensus level; contract must catch it.
    await expect(
      new TransactionBuilder({ provider })
        .addInput(utxo, contract.unlock.tokenPassthrough())
        .addOutput({
          to: recipient,
          amount: 9_000n,
          token: { ...token, nft: { capability: 'mutable', commitment: 'aabbccdd02' } },
        })
        .send(),
    ).rejects.toThrow(/failed/i);
  });

  it('downgrading capability (mutable → none) fails: tokenCategory includes the capability byte', async () => {
    const { provider, contract } = setup();
    const token = randomNFT({ nft: { capability: 'mutable', commitment: 'aa' } });
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 10_000n, token }));
    // Downgrade is consensus-legal; only the capability byte in OP_*TOKENCATEGORY exposes it.
    await expect(
      new TransactionBuilder({ provider })
        .addInput(utxo, contract.unlock.tokenPassthrough())
        .addOutput({
          to: recipient,
          amount: 9_000n,
          token: { ...token, nft: { capability: 'none', commitment: 'aa' } },
        })
        .send(),
    ).rejects.toThrow(/failed/i);
  });

  it('checkDataSig verifies a Schnorr signature over sha256(message)', async () => {
    const { provider, contract } = setup();
    const msg = Uint8Array.from([...recipient, 1, 2, 3]);
    const sig = secp256k1.signMessageHashSchnorr(priv, sha256.hash(msg)) as Uint8Array;
    expect(sig.length).toBe(64);
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 10_000n }));
    await new TransactionBuilder({ provider })
      .addInput(utxo, contract.unlock.dataSig(sig, msg))
      .addOutput({ to: recipient, amount: 9_000n })
      .send();

    // Signing the raw message (not its hash) does not verify.
    const bad = secp256k1.signMessageHashSchnorr(priv, msg.slice(0, 32)) as Uint8Array;
    const utxo2 = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 10_000n }));
    await expect(
      new TransactionBuilder({ provider })
        .addInput(utxo2, contract.unlock.dataSig(bad, msg))
        .addOutput({ to: recipient, amount: 9_000n })
        .send(),
    ).rejects.toThrow(/failed/i);
  });

  it('do…while loops run on the 2026 VM (OP_BEGIN/OP_UNTIL)', async () => {
    const { provider, contract } = setup();
    expect(artifact.bytecode).toContain('OP_BEGIN');
    expect(artifact.bytecode).toContain('OP_UNTIL');
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 100_000n }));
    const tb = new TransactionBuilder({ provider }).addInput(utxo, contract.unlock.loop());
    for (let i = 0; i < 5; i++) tb.addOutput({ to: recipient, amount: 5_000n });
    await tb.send();

    const utxo2 = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 100_000n }));
    const tb2 = new TransactionBuilder({ provider }).addInput(utxo2, contract.unlock.loop());
    for (let i = 0; i < 4; i++) tb2.addOutput({ to: recipient, amount: 5_000n });
    tb2.addOutput({ to: recipient, amount: 999n }); // 5th output below loop threshold
    await expect(tb2.send()).rejects.toThrow(/failed/i);
  });

  it('tx.time compiles to CHECKLOCKTIMEVERIFY and needs locktime >= t', async () => {
    const { provider, contract } = setup();
    expect(artifact.bytecode).toContain('OP_CHECKLOCKTIMEVERIFY');
    const t = 1_700_000_000n;
    const utxo = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 10_000n }));
    await new TransactionBuilder({ provider })
      .addInput(utxo, contract.unlock.afterTime(t))
      .addOutput({ to: recipient, amount: 9_000n })
      .setLocktime(Number(t))
      .send();

    const utxo2 = provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis: 10_000n }));
    await expect(
      new TransactionBuilder({ provider })
        .addInput(utxo2, contract.unlock.afterTime(t))
        .addOutput({ to: recipient, amount: 9_000n })
        .setLocktime(Number(t) - 1)
        .send(),
    ).rejects.toThrow(/failed/i);
  });
});

describe('§15.1 P2S size', () => {
  it('the spec draft contract exceeds the 201-byte P2S limit', () => {
    const draft = compileFile(new URL('../spikes/draft-hongbao.cash', import.meta.url));
    const c = new Contract(
      draft,
      [pk, pk, recipient, 1_800_000_000n, 2000n],
      { provider: new MockNetworkProvider(), contractType: 'p2s' },
    );
    console.log('draft P2S bytesize:', c.bytesize, 'locking bytes:', c.lockingBytecode.length / 2);
    expect(c.bytesize).toBeGreaterThan(201);
  });
});
