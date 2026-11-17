// Show what an address holds on-chain: UTXOs (with tokens) and tx history with heights.
// Usage: pnpm --filter @hongbao/scripts addr-check -- [--mainnet] bchtest:q… | bitcoincash:q…
import { PREFIX, isOwnNetworkAddress } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';

const addr = process.argv[2];
if (!isOwnNetworkAddress(addr)) throw new Error(`usage: addr-check [--mainnet] ${PREFIX}:…`);

const p = await chipnetProvider();
const tip = await p.getBlockHeight();
const utxos = await p.getUtxos(addr);
const history = (await p.performRequest('blockchain.address.get_history', addr)) as { tx_hash: string; height: number }[];

console.log(`${addr}  (tip ${tip})`);
console.log(`utxos: ${utxos.length}`);
for (const u of utxos) {
  const t = u.token ? `  token ${u.token.category.slice(0, 12)}… ${u.token.nft?.commitment ?? ''}` : '';
  console.log(`  ${u.txid}:${u.vout}  ${u.satoshis} sats${t}`);
}
console.log(`history: ${history.length}`);
for (const h of history) console.log(`  ${h.tx_hash}  ${h.height > 0 ? `block ${h.height}` : 'unconfirmed (mempool)'}`);
process.exit(0);
