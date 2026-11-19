// Script environment. Chipnet by default (spec §10.1 rule 1). Mainnet only when the command line
// says `--mainnet` AND the script is one of the manual tools below. The e2e suites and the Phase 2
// tools always refuse it. Mainnet keys and state live apart from Chipnet's (scripts/.state/mainnet).
// Scripts that broadcast on mainnet additionally require `--yes-mainnet` (requireMainnetConsent).
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

if ((process.env.NETWORK ?? 'CHIPNET') !== 'CHIPNET') {
  throw new Error(`scripts/ expect NETWORK=CHIPNET in .env (got ${process.env.NETWORK}); use --mainnet instead. Refusing.`);
}

/** Manual tools that may run on mainnet. Everything else (e2e suites, fund/claim/refund) can't. */
const MAINNET_ALLOWED = ['wallet', 'inspect', 'addr-check', 'send', 'seal-to-wallet', 'demo-envelope', 'blaze-drop'];

const script = basename(process.argv[1] ?? '').replace(/\.[cm]?[jt]s$/, '');
const wantMainnet = process.argv.includes('--mainnet');
const spendConsent = process.argv.includes('--yes-mainnet');
// `pnpm <script> -- --flag` forwards the literal "--"; drop it (and our own flags) so parseArgs works.
process.argv = process.argv.filter((arg, i) => !(i >= 2 && (arg === '--' || arg === '--mainnet' || arg === '--yes-mainnet')));

if (wantMainnet && !MAINNET_ALLOWED.includes(script)) {
  throw new Error(`${script} is Chipnet-only (spec §10.1 rule 1). --mainnet works for: ${MAINNET_ALLOWED.join(', ')}.`);
}

export const MAINNET = wantMainnet;
export const NET = MAINNET ? ('mainnet' as const) : ('chipnet' as const);
export const API_NETWORK = MAINNET ? 'MAINNET' : 'CHIPNET';
export const PREFIX = MAINNET ? ('bitcoincash' as const) : ('bchtest' as const);

/** Fulcrum hostnames. Mainnet ignores .env's (Chipnet) FULCRUM_URLS; override with MAINNET_FULCRUM_URLS. */
export const FULCRUM_HOSTS = (
  MAINNET
    ? (process.env.MAINNET_FULCRUM_URLS ?? 'wss://bch.imaginary.cash:50004,wss://fulcrum.greyh.at:50004')
    : (process.env.FULCRUM_URLS ?? 'wss://chipnet.imaginary.cash:50004,wss://chipnet.bch.ninja:50004')
)
  .split(',')
  .map((u) => new URL(u.trim()).hostname);

export const PUBLIC_API_URL = process.env.PUBLIC_API_URL ?? 'http://localhost:3000';
export const EXPLORER_TX = MAINNET ? 'https://blockchair.com/bitcoin-cash/transaction/' : 'https://chipnet.imaginary.cash/tx/';
export const STATE_DIR = fileURLToPath(new URL(MAINNET ? '../../.state/mainnet/' : '../../.state/', import.meta.url));

if (MAINNET) console.warn('⚠️  MAINNET mode: real BCH.');

/** Call before broadcasting anything: on mainnet, refuse unless the command carried --yes-mainnet. */
export function requireMainnetConsent(what: string) {
  if (MAINNET && !spendConsent) {
    throw new Error(`Refusing to ${what} on MAINNET without --yes-mainnet (real money).`);
  }
}

/** Address with this network's prefix? */
export const isOwnNetworkAddress = (a: string | undefined): a is string => !!a && a.startsWith(`${PREFIX}:`);
