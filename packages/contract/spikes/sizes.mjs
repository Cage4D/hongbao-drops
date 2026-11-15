// Phase 0 spike: dust floors (§15.3) and claim / batch-refund tx sizes (§15.4) for the draft contract.
import { compileFile } from 'cashc';
import { Contract, MockNetworkProvider, TransactionBuilder, SignatureTemplate, randomUtxo, randomNFT } from 'cashscript';
import { calculateDust } from '../node_modules/cashscript/dist/utils.js';
import { secp256k1, sha256, hash160, hexToBin, swapEndianness } from '@bitauth/libauth';

const enc = (s) => new TextEncoder().encode(s);
const linkPriv = sha256.hash(enc('link')); const gatePriv = sha256.hash(enc('gate'));
const linkPk = secp256k1.derivePublicKeyCompressed(linkPriv); const gatePk = secp256k1.derivePublicKeyCompressed(gatePriv);
const p2pkh = (pub) => Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pub), 0x88, 0xac]);
const recipient = p2pkh(linkPk);
const nft = () => randomNFT({ nft: { capability: 'none', commitment: '0000000101' } });

// --- dust ---
const p2sh32 = Uint8Array.from([0xaa, 0x20, ...new Uint8Array(32), 0x87]);
console.log('dust P2PKH plain      ', calculateDust({ to: recipient, amount: 0n }));
console.log('dust P2PKH + NFT(5B)  ', calculateDust({ to: recipient, amount: 0n, token: nft() }));
console.log('dust P2SH32 plain     ', calculateDust({ to: p2sh32, amount: 0n }));
console.log('dust P2SH32 + NFT(5B) ', calculateDust({ to: p2sh32, amount: 0n, token: nft() }));

// --- sizes ---
const artifact = compileFile(new URL('./draft-hongbao.cash', import.meta.url));
const expiry = 1_700_000_000n;
const provider = new MockNetworkProvider();
const c = new Contract(artifact, [linkPk, gatePk, recipient, expiry, 2000n], { provider });
console.log('contract bytesize (redeem script)', c.bytesize);

for (const withNft of [false, true]) {
  const token = withNft ? nft() : undefined;
  const u = provider.addUtxo(c.tokenAddress, randomUtxo({ satoshis: 10_000n, ...(token && { token }) }));
  const msg = Uint8Array.from([...recipient, ...hexToBin(swapEndianness(u.txid)), u.vout, 0, 0, 0]);
  const gateSig = secp256k1.signMessageHashSchnorr(gatePriv, sha256.hash(msg));
  const hex = new TransactionBuilder({ provider })
    .addInput(u, c.unlock.claim(new SignatureTemplate(linkPriv), gateSig))
    .addOutput({ to: recipient, amount: 9_500n, ...(token && { token }) })
    .build();
  console.log(`claim tx ${withNft ? 'with NFT' : 'BCH-only'}: ${hex.length / 2} bytes`);
}

for (const n of [1, 5, 10, 20]) {
  const tb = new TransactionBuilder({ provider });
  for (let i = 0; i < n; i++) {
    const token = nft();
    const u = provider.addUtxo(c.tokenAddress, randomUtxo({ satoshis: 10_000n, token }));
    tb.addInput(u, c.unlock.refundBatch());
    tb.addOutput({ to: recipient, amount: 9_500n, token });
  }
  tb.setLocktime(Number(expiry));
  const hex = tb.build();
  console.log(`refundBatch ${n} shares (NFTs): ${hex.length / 2} bytes (${Math.ceil(hex.length / 2 / n)} B/share)`);
  await tb.send(); // also proves the loop passes VM validation at this size
}
