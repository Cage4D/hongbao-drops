// "BLAZE Drop": our own Sponsored Drop campaign on mainnet, the source of the README's campaign table.
// Creates the sponsor and campaign once (kept in the state dir with the sponsor token, mode 600), then
// creates and funds the envelopes from the demo wallet, each paying the 3% sponsor fee to the treasury.
// Prints the public proof page (/c/<campaignId>) and writes the share links to a file (mode 600).
//
// Usage (mainnet):
//   pnpm --filter @hongbao/scripts blaze-drop -- --mainnet --yes-mainnet
//   [--envelopes 3] [--shares 10] [--sats 100000] [--hours 23.5] [--dry-run]
// --sats is per envelope. Re-running adds more envelopes to the same campaign.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { encodePrivateKeyWif } from '@bitauth/libauth';
import { API_NETWORK, EXPLORER_TX, MAINNET, STATE_DIR, requireMainnetConsent } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { walletKey } from './lib/keys.js';
import { apiClient, check, createAndFund } from './lib/api.js';

const { values: a } = parseArgs({
  options: {
    api: { type: 'string', default: 'https://hongbao-drops-api.vercel.app' },
    web: { type: 'string', default: 'https://hongbao-drops.vercel.app' },
    envelopes: { type: 'string', default: '3' },
    shares: { type: 'string', default: '10' },
    sats: { type: 'string', default: '100000' },
    hours: { type: 'string', default: '23.5' },
    'dry-run': { type: 'boolean', default: false },
  },
});
const count = Number(a.envelopes);
const shares = Number(a.shares);
const totalSats = Number(a.sats);
const hours = Number(a.hours);
if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('--envelopes must be 1..5');
if (!Number.isInteger(shares) || shares < 1 || shares > 10) throw new Error('--shares must be 1..10');
if (!Number.isInteger(totalSats) || totalSats < shares * 2000) throw new Error(`--sats must be at least ${shares * 2000}`);
if (!(hours > 0 && hours <= 24)) throw new Error('--hours must be in (0, 24]');

// Each envelope a little different, to show the modes and themes.
const STYLES = [
  { mode: 'EQUAL', theme: 'gold', message: 'BLAZE Drop 🧧 Your first Bitcoin Cash, on us. Open it and pass it on!' },
  { mode: 'LUCKY', theme: 'lunar', message: 'BLAZE Drop 🧧 Lucky split: who gets the biggest share?' },
  { mode: 'EQUAL', theme: 'classic-red', message: 'BLAZE Drop 🧧 Real BCH and a Hongbao Seal for the first 10 to open it.' },
];

interface State {
  sponsorToken: string;
  campaignId: string;
  envelopes: { id: string; slug: string; fundingTxid: string; link: string }[];
}
const web = a.web!.replace(/\/$/, '');
const stateFile = join(STATE_DIR, 'blaze-drop.json');
let state: State | null = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as State) : null;
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });

const call = apiClient(a.api!);
const health = await call('GET', '/health');
check(health.body?.network === API_NETWORK, `API on ${API_NETWORK} (${a.api})`);
const provider = await chipnetProvider();
const wallet = walletKey();
const balance = (await provider.getUtxos(wallet.address)).filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n);
const need = count * Math.ceil(totalSats * 1.03 + 3_000);
check(balance > BigInt(need), `demo wallet holds ${balance} sats (need ≈ ${need} with fees)`);
const usd = health.body.priceUsd ? ` ≈ $${(((count * totalSats) / 1e8) * health.body.priceUsd).toFixed(2)}` : '';
console.log(`   plan: ${count} envelope(s) × ${shares} shares × ${totalSats / shares} sats = ${count * totalSats} sats${usd} + 3% sponsor fee, seals on, ${hours} h`);
console.log(state ? `   reusing campaign ${state.campaignId} (${state.envelopes.length} envelope(s) so far)` : '   will create sponsor "Hongbao Drops" and campaign "BLAZE Drop"');
if (a['dry-run']) {
  console.log('   dry run: stopping before anything is created or spent.');
  process.exit(0);
}
requireMainnetConsent(`fund ${count} BLAZE Drop envelope(s) of ${totalSats} sats`);

if (!state) {
  const sp = await call('POST', '/sponsors', { name: 'Hongbao Drops', brandColor: '#3DA9FF', ctaLabel: 'Send your own drop', ctaUrl: `${web}/send` });
  check(sp.status === 201, 'sponsor "Hongbao Drops" created (token saved, not printed)');
  const c = await call('POST', '/campaigns', { name: 'BLAZE Drop' }, { authorization: `Bearer ${sp.body.sponsorToken}` });
  check(c.status === 201 && !!c.body.campaignId, `campaign "BLAZE Drop" ${c.body.campaignId}`);
  state = { sponsorToken: sp.body.sponsorToken, campaignId: c.body.campaignId, envelopes: [] };
  save();
}

for (let i = 0; i < count; i++) {
  const style = STYLES[state.envelopes.length % STYLES.length]!;
  const { env, linkPriv, fundingTxid } = await createAndFund(call, provider, {
    sponsorToken: state.sponsorToken,
    campaignId: state.campaignId,
    shareCount: shares,
    totalSats,
    ...style,
    expiry: Math.floor(Date.now() / 1000) + Math.floor(hours * 3600),
  });
  const link = `${web}/${env.slug}#k=${encodePrivateKeyWif(linkPriv, MAINNET ? 'mainnet' : 'testnet')}`;
  state.envelopes.push({ id: env.id, slug: env.slug, fundingTxid, link });
  save();
  console.log(`   envelope ${state.envelopes.length} (${style.mode}, ${env.slug}) funded: ${EXPLORER_TX}${fundingTxid}`);
}

const linksFile = join(STATE_DIR, 'blaze-drop-links.txt');
writeFileSync(linksFile, `${state.envelopes.map((e) => e.link).join('\n')}\n`, { mode: 0o600 });
console.log(`\n   Share links: ${linksFile}`);
console.log(`   Public proof page: ${web}/c/${state.campaignId}`);
process.exit(0);
