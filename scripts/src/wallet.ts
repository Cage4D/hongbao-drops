// Show the Chipnet test wallet (fund this from a faucet) and the treasury.
// Usage: pnpm --filter @hongbao/scripts wallet
import './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { treasuryKey, walletKey } from './lib/keys.js';

const provider = await chipnetProvider();
for (const [label, k] of [['wallet', walletKey()], ['treasury', treasuryKey()]] as const) {
  const utxos = await provider.getUtxos(k.address);
  const bch = utxos.reduce((a, u) => a + u.satoshis, 0n);
  console.log(`\n${label}: ${k.address}\n  token address: ${k.tokenAddress}\n  balance: ${bch} sats in ${utxos.length} UTXOs`);
  for (const u of utxos) {
    const tok = u.token ? `  token ${u.token.category.slice(0, 8)}… ${u.token.nft?.commitment ?? ''}` : '';
    console.log(`   ${u.txid}:${u.vout}  ${u.satoshis}${tok}`);
  }
}
console.log('\nFaucets: https://tbch.googol.cash  ·  https://chipnet.bch.ninja');
process.exit(0);
