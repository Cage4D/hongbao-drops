// Dust limit of an output, matching the node rule 3 × (serialized output size + 148) sats.
// Gives 546 for P2PKH, 576 for P2SH32, 666 for P2PKH + immutable NFT with a 5-byte commitment
// (the values measured in Phase 0, docs/findings.md §3).
import type { TokenDetails } from 'cashscript';

const varIntLen = (n: number | bigint) => (BigInt(n) < 0xfdn ? 1 : BigInt(n) <= 0xffffn ? 3 : BigInt(n) <= 0xffffffffn ? 5 : 9);

export function dustLimit(lockingBytecodeLength: number, token?: TokenDetails): bigint {
  let prefix = 0;
  if (token) {
    const commitment = token.nft?.commitment ? token.nft.commitment.length / 2 : 0;
    prefix = 1 + 32 + 1 + (commitment > 0 ? varIntLen(commitment) + commitment : 0) + (token.amount > 0n ? varIntLen(token.amount) : 0);
  }
  const script = prefix + lockingBytecodeLength;
  const size = 8 + varIntLen(script) + script;
  return 3n * BigInt(size + 148);
}
