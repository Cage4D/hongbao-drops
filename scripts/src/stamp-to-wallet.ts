// Phase 6 wallet check: create + fund a stamped envelope through the API, then claim one share to a
// real wallet address so its stamp NFT (and BCMR metadata) can be inspected in Paytaca / Cashonize.
// The API's PUBLIC_API_URL must be reachable over HTTPS by the wallet, or the metadata can't load.
// Usage: pnpm --filter @hongbao/scripts stamp-to-wallet -- --to bchtest:q… [--api http://localhost:3000] [--theme lunar]
import { parseArgs } from 'node:util';
import { cashAddressToLockingBytecode, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { buildClaimTx } from '@hongbao/contract';
import type { ClaimApproval } from '@hongbao/shared';
import { EXPLORER_TX } from './lib/env.js';
import { chipnetProvider } from './lib/chain.js';
import { apiClient, check, createAndFund } from './lib/api.js';

const { values: a } = parseArgs({
  options: {
    to: { type: 'string' },
    api: { type: 'string', default: 'http://localhost:3000' },
    theme: { type: 'string', default: 'lunar' },
  },
});
if (!a.to?.startsWith('bchtest:')) throw new Error('--to must be a bchtest: address');
// Send the stamp to the token-aware (z…) form of the same key so wallets show the NFT.
const lb = cashAddressToLockingBytecode(a.to);
if (typeof lb === 'string') throw new Error(lb);
const tokenAddr = lockingBytecodeToCashAddress({ bytecode: lb.bytecode, prefix: 'bchtest', tokenSupport: true });
const to = typeof tokenAddr === 'string' ? a.to : tokenAddr.address;

const call = apiClient(a.api!);
const provider = await chipnetProvider();
const health = await call('GET', '/health');
check(health.body.network === 'CHIPNET', `API on CHIPNET (${a.api})`);

const env = await createAndFund(call, provider, {
  shareCount: 2,
  mode: 'EQUAL',
  totalSats: 10_000,
  theme: a.theme,
  message: 'Phase 6 stamp check 🧧',
  expiry: Math.floor(Date.now() / 1000) + 24 * 3600,
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
