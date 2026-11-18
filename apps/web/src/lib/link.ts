// The share link carries the link secret in the URL fragment only (handoff §3).
import { binToHex, decodePrivateKeyWif, encodePrivateKeyWif, generatePrivateKey, secp256k1 } from '@bitauth/libauth';
import type { NetCfg } from './network';

export function newLinkKey(cfg: NetCfg) {
  const priv = generatePrivateKey();
  const pk = binToHex(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array);
  const wif = encodePrivateKeyWif(priv, cfg.wifNetwork);
  return { pk, wif };
}

export function shareUrl(env: { id: string; slug?: string }, wif: string): string {
  return env.slug ? `${location.origin}/${env.slug}#k=${wif}` : `${location.origin}/e/${env.id}#k=${wif}`;
}

/** Reads #k= from the current URL. null = missing, 'bad' = present but not a valid key. */
export function readLinkKey(): Uint8Array | null | 'bad' {
  const k = new URLSearchParams(location.hash.slice(1)).get('k');
  if (!k) return null;
  const d = decodePrivateKeyWif(k);
  return typeof d === 'string' ? 'bad' : d.privateKey;
}
