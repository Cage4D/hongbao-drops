// Backward compatibility for the rename of the claimer NFTs from "stamps" to "Hongbao Seals"
// (2026-11-18). Claims saved on this device before the rename store the NFT under the old key;
// this upgrades them on read so the success screen still shows the seal.
const LEGACY_SEAL_KEY = 'stamp';

export function upgradeStoredClaim<T extends { seal?: unknown }>(c: T | null): T | null {
  if (!c || c.seal !== undefined) return c;
  const legacy = (c as Record<string, unknown>)[LEGACY_SEAL_KEY];
  return legacy === undefined ? c : { ...c, seal: legacy };
}
