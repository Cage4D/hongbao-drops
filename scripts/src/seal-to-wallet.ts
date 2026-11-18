// Wallet check: create + fund a seal-bearing envelope through the API, then claim one share to a real
// wallet address so its seal NFT (and BCMR metadata) can be inspected in Paytaca / Cashonize.
// The API's PUBLIC_API_URL must be reachable over HTTPS by the wallet, or the metadata can't load.
// Usage: pnpm --filter @hongbao/scripts seal-to-wallet -- --to bchtest:q… [--api http://localhost:3000] [--theme lunar]
// Mainnet (Nov 19 Paytaca check): add --mainnet --yes-mainnet. Defaults to the cheapest seal-bearing
// envelope (1 share × 2,000 sats ≈ $0.004), funded from the demo wallet; capped at 20,000 sats.
// --shares 2 --sats 4000 --expiry-minutes 15 also leaves one share for the keeper to batch-refund.
import { parseArgs } from 'node:util';
import { cashAddressToLockingBytecode, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { buildClaimTx } from '@hongbao/contract';
import type { ClaimApproval } from '@hongbao/shared';
import { API_NETWORK, EXPLORER_TX, MAINNET, PREFIX, isOwnNetworkAddress, requireMainnetConsent } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { apiClient, check, createAndFund } from './lib/api.js';

const { values: a } = parseArgs({
  options: {
    to: { type: 'string' },
    api: { type: 'string', default: 'http://localhost:3000' },
    theme: { type: 'string', default: 'lunar' },
    shares: { type: 'string', default: MAINNET ? '1' : '2' },
    sats: { type: 'string', default: MAINNET ? '2000' : '10000' },
    /** Unclaimed shares refund to the sender ~1 h after expiry (median-time-past lag). */
    'expiry-minutes': { type: 'string', default: MAINNET ? '120' : String(24 * 60) },
  },
});
const expiryMinutes = Number(a['expiry-minutes']);
if (MAINNET && expiryMinutes > 24 * 60) throw new Error('mainnet expiry is at most 24 h');
if (!isOwnNetworkAddress(a.to)) throw new Error(`--to must be a ${PREFIX}: address`);
const totalSats = Number(a.sats);
if (MAINNET && totalSats > 20_000) throw new Error('mainnet seal checks are capped at 20,000 sats');
// Send the seal to the token-aware (z…) form of the same key so wallets show the NFT.
const lb = cashAddressToLockingBytecode(a.to);
if (typeof lb === 'string') throw new Error(lb);
const tokenAddr = lockingBytecodeToCashAddress({ bytecode: lb.bytecode, prefix: PREFIX, tokenSupport: true });
const to = typeof tokenAddr === 'string' ? a.to : tokenAddr.address;

const call = apiClient(a.api!);
const provider = await chipnetProvider();
const health = await call('GET', '/health');
check(health.body.network === API_NETWORK, `API on ${API_NETWORK} (${a.api})`);
requireMainnetConsent(`fund a ${totalSats}-sat seal-bearing envelope and claim it to ${to}`);

const env = await createAndFund(call, provider, {
  shareCount: Number(a.shares),
  mode: 'EQUAL',
  totalSats,
  theme: a.theme,
  message: 'Hongbao seal check 🧧',
  expiry: Math.floor(Date.now() / 1000) + expiryMinutes * 60,
});
console.log(`   funded: ${EXPLORER_TX}${env.fundingTxid} (slug ${env.env.slug})`);
console.log(`   BCMR:   https://${env.env.bcmr!.uri}  (hash ${env.env.bcmr!.hash})`);

const ap = (await call('POST', `/envelopes/${env.env.id}/claims`, { recipientAddress: to })).body as ClaimApproval;
const { hex } = buildClaimTx({
  provider,
  constructorArgs: ap.constructorArgs,
  share: ap.share,
  recipientLockingBytecode: ap.recipientLockingBytecode,
  linkPrivateKey: env.linkPriv,
  gateSig: ap.gateSig,
});
const b = await call('POST', `/claims/${ap.claimId}/broadcast`, { rawTx: hex });
check(b.status === 200, `seal ${b.body.seal?.commitment} + ${b.body.amountSats} sats → ${to}`);
console.log(`   claim tx:  ${EXPLORER_TX}${b.body.txid}`);
console.log(`   seal PNG: ${b.body.seal?.imageUrl}`);
console.log(`   category:  ${b.body.seal?.category}`);
process.exit(0);
