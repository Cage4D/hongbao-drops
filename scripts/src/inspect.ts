// Decode a tx straight from Fulcrum and print every output (independent of our builders).
// Usage: pnpm --filter @hongbao/scripts inspect -- [--mainnet] <txid> [<txid>…]
import { PREFIX } from './lib/env.js';
import { binToHex, decodeTransaction, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { chipnetProvider } from './lib/chain.js';

const provider = await chipnetProvider();
for (const txid of process.argv.slice(2)) {
  const tx = decodeTransaction(hexToBin(await provider.getRawTransaction(txid)));
  if (typeof tx === 'string') throw new Error(tx);
  console.log(`\n${txid}  (${tx.inputs.length} in → ${tx.outputs.length} out, locktime ${tx.locktime})`);
  tx.inputs.forEach((i, n) =>
    console.log(`  in  ${n}: ${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}  seq ${i.sequenceNumber.toString(16)}`),
  );
  tx.outputs.forEach((o, n) => {
    const lb = o.lockingBytecode;
    let to: string;
    if (lb[0] === 0x6a) {
      const tag = new TextDecoder().decode(lb.slice(2, 6));
      to = `OP_RETURN ${tag} hash=${binToHex(lb.slice(7, 39))} uri=${new TextDecoder().decode(lb.slice(41))}`;
    } else {
      const a = lockingBytecodeToCashAddress({ bytecode: lb, prefix: PREFIX, tokenSupport: !!o.token });
      to = typeof a === 'string' ? binToHex(lb) : a.address;
    }
    const tok = o.token
      ? `  NFT ${binToHex(o.token.category).slice(0, 12)}… cap=${o.token.nft?.capability} commit=${binToHex(o.token.nft?.commitment ?? new Uint8Array())}`
      : '';
    console.log(`  out ${n}: ${String(o.valueSatoshis).padStart(7)}  ${to}${tok}`);
  });
}
process.exit(0);
