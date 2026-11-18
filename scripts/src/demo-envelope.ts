// Judges' demo envelope (the landing page's "Try it free"): create + fund one envelope from the
// demo wallet, register it with POST /admin/demo/refill, and print its share link.
//
// Every demo envelope reuses one link key (state dir: demo-link.json), so all refills share the same
// #k= secret. Only the slug changes. The server never sees the key (non-custodial, handoff §3).
// The admin token is read from the secrets file and never printed.
//
// Usage (mainnet):
//   pnpm --filter @hongbao/scripts demo-envelope -- --mainnet --yes-mainnet
//   [--shares 10] [--sats 50000] [--hours 23.5] [--api …] [--web …] [--secrets <file>] [--dry-run]
// --dry-run checks the API, the current demo and the wallet balance, then stops before spending.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { binToHex, encodePrivateKeyWif, generatePrivateKey, hexToBin, secp256k1 } from '@bitauth/libauth';
import { API_NETWORK, EXPLORER_TX, MAINNET, STATE_DIR, requireMainnetConsent } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { walletKey } from './lib/keys.js';
import { apiClient, check, createAndFund } from './lib/api.js';

const { values: a } = parseArgs({
  options: {
    api: { type: 'string', default: 'https://hongbao-drops-api.vercel.app' },
    web: { type: 'string', default: 'https://hongbao-drops.vercel.app' },
    shares: { type: 'string', default: '10' },
    sats: { type: 'string', default: '50000' },
    hours: { type: 'string', default: '23.5' },
    theme: { type: 'string', default: 'lunar' },
    message: { type: 'string', default: 'Happy Lunar New Year! 🧧 This one is on us. Claim your share.' },
    secrets: { type: 'string', default: join(homedir(), '.local/share/hongbao-drops', MAINNET ? 'mainnet-secrets.env' : 'prod-secrets.env') },
    'dry-run': { type: 'boolean', default: false },
  },
});
const shares = Number(a.shares);
const totalSats = Number(a.sats);
const hours = Number(a.hours);
if (!Number.isInteger(shares) || shares < 1 || shares > 10) throw new Error('--shares must be 1..10');
if (!Number.isInteger(totalSats) || totalSats < shares * 2000) throw new Error(`--sats must be at least ${shares * 2000} (2,000 per seal-bearing share)`);
if (MAINNET && totalSats > 100_000) throw new Error('mainnet demo envelopes are capped at 100,000 sats here');
if (!(hours > 0 && hours <= 24)) throw new Error('--hours must be in (0, 24]');

// Admin token from the secrets file (KEY=value lines); never echoed.
if (!existsSync(a.secrets!)) throw new Error(`secrets file not found: ${a.secrets}`);
const adminToken = readFileSync(a.secrets!, 'utf8').match(/^ADMIN_TOKEN=(.+)$/m)?.[1]?.trim();
if (!adminToken) throw new Error(`no ADMIN_TOKEN in ${a.secrets}`);
const auth = { authorization: `Bearer ${adminToken}` };

// The shared demo link key, created once and kept with the other state (gitignored, mode 600).
const keyFile = join(STATE_DIR, 'demo-link.json');
if (!existsSync(keyFile)) writeFileSync(keyFile, JSON.stringify({ privHex: binToHex(generatePrivateKey()) }, null, 2), { mode: 0o600, flag: 'wx' });
const linkPriv = hexToBin(JSON.parse(readFileSync(keyFile, 'utf8')).privHex);
const linkPk = binToHex(secp256k1.derivePublicKeyCompressed(linkPriv) as Uint8Array);
const wif = encodePrivateKeyWif(linkPriv, MAINNET ? 'mainnet' : 'testnet');

const call = apiClient(a.api!);
const health = await call('GET', '/health');
check(health.body?.network === API_NETWORK, `API on ${API_NETWORK} (${a.api})`);

const demo = await call('GET', '/admin/demo', undefined, auth);
check(demo.status === 200, 'admin token accepted');
check(demo.body.needsRefill === true, demo.body.envelopeId
  ? `current demo ${demo.body.slug} needs a refill (${demo.body.sharesLeft}/${demo.body.sharesTotal} left, ${demo.body.secondsLeft}s to go)`
  : 'no demo envelope yet');

const provider = await chipnetProvider();
const wallet = walletKey();
const balance = (await provider.getUtxos(wallet.address)).filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n);
check(balance > BigInt(totalSats + 10_000), `demo wallet holds ${balance} sats (need ${totalSats} + fees)`);
const usd = health.body.priceUsd ? ` ≈ $${((totalSats / 1e8) * health.body.priceUsd).toFixed(3)}` : '';
console.log(`   plan: ${shares} × ${totalSats / shares} sats = ${totalSats} sats${usd}, seals on, expires in ${hours} h`);
if (a['dry-run']) {
  console.log('   dry run: stopping before anything is created or spent.');
  process.exit(0);
}

requireMainnetConsent(`fund a ${totalSats}-sat demo envelope`);
const { env, fundingTxid } = await createAndFund(call, provider, {
  shareCount: shares,
  mode: 'EQUAL',
  totalSats,
  theme: a.theme,
  message: a.message,
  linkPk,
  expiry: Math.floor(Date.now() / 1000) + Math.floor(hours * 3600),
});
console.log(`   funded: ${EXPLORER_TX}${fundingTxid} (id ${env.id}, slug ${env.slug})`);

const reg = await call('POST', '/admin/demo/refill', { envelopeId: env.id }, auth);
check(reg.status === 200, `registered as the demo envelope (${reg.body.sharesLeft}/${reg.body.sharesTotal} shares)`);

const link = `${a.web!.replace(/\/$/, '')}/${env.slug}#k=${wif}`;
writeFileSync(join(STATE_DIR, 'demo-link.txt'), `${link}\n`, { mode: 0o600 });
console.log(`\n   Demo link (also in ${join(STATE_DIR, 'demo-link.txt')}):\n   ${link}`);
console.log('   Set it as VITE_DEMO_URL in Vercel project hongbao-drops (Production, Sensitive), then redeploy.');
process.exit(0);
