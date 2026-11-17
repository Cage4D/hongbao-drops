// Wallet check: create + fund a stamped envelope through the API, then claim one share to a real
// wallet address so its stamp NFT (and BCMR metadata) can be inspected in Paytaca / Cashonize.
// The API's PUBLIC_API_URL must be reachable over HTTPS by the wallet, or the metadata can't load.
// Usage: pnpm --filter @hongbao/scripts stamp-to-wallet -- --to bchtest:q… [--api http://localhost:3000] [--theme lunar]
// Mainnet (Nov 19 Paytaca check): add --mainnet --yes-mainnet. Defaults to the cheapest stamped
// envelope (1 share × 2,000 sats ≈ $0.004), funded from the demo wallet; capped at 20,000 sats.
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
  },
});
if (!isOwnNetworkAddress(a.to)) throw new Error(`--to must be a ${PREFIX}: address`);
const totalSats = Number(a.sats);
if (MAINNET && totalSats > 20_000) throw new Error('mainnet stamp checks are capped at 20,000 sats');
// Send the stamp to the token-aware (z…) form of the same key so wallets show the NFT.
const lb = cashAddressToLockingBytecode(a.to);
if (typeof lb === 'string') throw new Error(lb);
const tokenAddr = lockingBytecodeToCashAddress({ bytecode: lb.bytecode, prefix: PREFIX, tokenSupport: true });
const to = typeof tokenAddr === 'string' ? a.to : tokenAddr.address;

const call = apiClient(a.api!);
const provider = await chipnetProvider();
const health = await call('GET', '/health');
check(health.body.network === API_NETWORK, `API on ${API_NETWORK} (${a.api})`);
requireMainnetConsent(`fund a ${totalSats}-sat stamped envelope and claim it to ${to}`);

const env = await createAndFund(call, provider, {
  shareCount: Number(a.shares),
  mode: 'EQUAL',
  totalSats,
  theme: a.theme,
  message: 'Hongbao stamp check 🧧',
  // Short on mainnet: anything unclaimed refunds to the demo wallet ~1 h after expiry.
  expiry: Math.floor(Date.now() / 1000) + (MAINNET ? 2 * 3600 : 24 * 3600),
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
check(b.status === 200, `stamp ${b.body.stamp?.commitment} + ${b.body.amountSats} sats → ${to}`);
console.log(`   claim tx:  ${EXPLORER_TX}${b.body.txid}`);
console.log(`   stamp PNG: ${b.body.stamp?.imageUrl}`);
console.log(`   category:  ${b.body.stamp?.category}`);
process.exit(0);
