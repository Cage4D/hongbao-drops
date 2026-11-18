// Backward compatibility for the rename of the claimer NFTs from "stamps" to "Hongbao Seals"
// (2026-11-18, BCH BLAZE 2026). Every old name the API still honours lives in this file, so the
// whole layer can be found and removed in one place.
//
// What depends on the old names:
//  - NFTs already minted: their BCMR registries (committed on-chain by hash, served byte-for-byte)
//    point wallets at /stamps/<category>/<commitment>.png. Those must keep loading → redirect.
//  - Frontend bundles built before the rename (an open tab keeps its JS for hours after a deploy)
//    send withStamps/stampCategory and read `stamp` from responses → accept and alias.
//  - Deployments that still set ENABLE_STAMPS → fallback with a deprecation warning.
//
// Remove the request/response aliases once no pre-rename bundle can still be open (a day after the
// release is plenty). Keep the media redirect for as long as old NFTs exist (i.e. forever).

/** Old env var for ENABLE_SEALS. */
export const LEGACY_ENABLE_ENV = 'ENABLE_STAMPS';

/** Old path prefix for seal images, used inside already-published BCMR registries. */
export const LEGACY_MEDIA_PREFIX = 'stamps';

/** Old request field names → new ones (POST /envelopes). */
export const LEGACY_REQUEST_FIELDS: Record<string, string> = { withStamps: 'withSeals', stampCategory: 'sealCategory' };

/** Accept a create-envelope body from a pre-rename frontend. New names win if both are sent. */
export function upgradeLegacyEnvelopeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const [oldKey, newKey] of Object.entries(LEGACY_REQUEST_FIELDS)) {
    if (oldKey in out) {
      if (!(newKey in out)) out[newKey] = out[oldKey];
      delete out[oldKey];
    }
  }
  return out;
}

/** Old response key for `seal`. */
export const LEGACY_RESPONSE_KEY = 'stamp';

/** Add the pre-rename key next to `seal` for old frontend bundles (same object). */
export function withLegacySealAlias<T extends { seal: unknown }>(o: T): T & { [LEGACY_RESPONSE_KEY]: T['seal'] } {
  return { ...o, [LEGACY_RESPONSE_KEY]: o.seal };
}
