// Show the script wallet and the treasury (addresses and coins only; keys are never printed).
// Usage: pnpm --filter @hongbao/scripts wallet [-- --mainnet [--create]]
//   Chipnet: keys are created on first use (fund the wallet from a faucet).
//   Mainnet: the dedicated demo wallet + treasury are created only with --create; fund the demo
//            wallet with the hackathon budget only (spec §10.1 rule 6).
import { parseArgs } from 'node:util';
import { MAINNET, STATE_DIR } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { treasuryKey, walletKey } from './lib/keys.js';

const { values: a } = parseArgs({ options: { create: { type: 'boolean', default: false } } });
const wallet = walletKey(a.create);
const treasury = treasuryKey(a.create);
if (a.create) console.log(`Keys in ${STATE_DIR} (mode 600, gitignored). Back up that folder; it is the only copy.`);

const provider = await chipnetProvider();
for (const [label, k] of [[MAINNET ? 'demo wallet' : 'wallet', wallet], ['treasury', treasury]] as const) {
  const utxos = await provider.getUtxos(k.address);
  const bch = utxos.reduce((s, u) => s + u.satoshis, 0n);
  console.log(`\n${label}: ${k.address}\n  token address: ${k.tokenAddress}\n  balance: ${bch} sats in ${utxos.length} UTXOs`);
  for (const u of utxos) {
    const tok = u.token ? `  token ${u.token.category.slice(0, 8)}… ${u.token.nft?.commitment ?? ''}` : '';
    console.log(`   ${u.txid}:${u.vout}  ${u.satoshis}${tok}`);
  }
}
if (!MAINNET) console.log('\nFaucets: https://tbch.googol.cash  ·  https://chipnet.bch.ninja');
process.exit(0);
