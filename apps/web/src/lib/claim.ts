// Flow B (claim), handoff §5. No wallet signature: the link key from #k= signs.
import { decodeCashAddress } from '@bitauth/libauth';
import { buildClaimTx } from '@hongbao/contract';
import type { BroadcastResponse, ClaimRequest } from '@hongbao/shared';
import { api } from './api';
import { chainProvider, type NetCfg } from './network';

export interface ClaimResult extends BroadcastResponse {
  envelopeId: string;
  recipientAddress: string;
  recipientLockingBytecode: string;
  isNewWallet: boolean | null;
  at: string;
}

export async function claimShare(cfg: NetCfg, envelopeId: string, linkPrivateKey: Uint8Array, body: ClaimRequest): Promise<ClaimResult> {
  const ap = await api.claim(envelopeId, body);
  // The share is reserved for 120 s: build and broadcast straight away.
  const { hex } = buildClaimTx({
    provider: chainProvider(cfg),
    constructorArgs: ap.constructorArgs,
    share: ap.share,
    recipientLockingBytecode: ap.recipientLockingBytecode,
    linkPrivateKey,
    gateSig: ap.gateSig,
  });
  const res = await api.broadcast(ap.claimId, hex);
  return {
    ...res,
    envelopeId,
    recipientAddress: body.recipientAddress,
    recipientLockingBytecode: ap.recipientLockingBytecode,
    isNewWallet: ap.isNewWallet,
    at: new Date().toISOString(),
  };
}

/** Accepts q…/z… with or without the prefix. Returns the normalised address or an error string. */
export function checkAddress(input: string, cfg: NetCfg): { ok: true; address: string } | { ok: false; error: string } {
  const raw = input.trim().replace(/^bitcoin cash:/i, '');
  if (!raw) return { ok: false, error: 'Paste your Bitcoin Cash address.' };
  const withPrefix = raw.includes(':') ? raw.toLowerCase() : `${cfg.prefix}:${raw.toLowerCase()}`;
  const d = decodeCashAddress(withPrefix);
  if (typeof d === 'string') return { ok: false, error: "That doesn't look like a Bitcoin Cash address." };
  if (d.prefix !== cfg.prefix)
    return { ok: false, error: cfg.network === 'MAINNET' ? 'That is a test-network address. Use a real Bitcoin Cash address.' : 'This drop runs on the test network (bchtest: addresses).' };
  if (d.type !== 'p2pkh' && d.type !== 'p2pkhWithTokens' && d.type !== 'p2sh' && d.type !== 'p2shWithTokens')
    return { ok: false, error: "That address type can't receive this share." };
  return { ok: true, address: withPrefix };
}
