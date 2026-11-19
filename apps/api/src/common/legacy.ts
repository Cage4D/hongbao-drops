// What's left of the claimer NFTs' rename from "stamps" to "Hongbao Seals" (2026-11-18): seals minted
// before the rename have BCMR registries (committed on-chain by hash, served byte-for-byte) that point
// wallets at /stamps/<category>/<commitment>.png. Those images must keep loading for as long as the
// NFTs exist, so the old path redirects to /seals/… (media.controller.ts). The request, response and
// env-var aliases were removed once no pre-rename frontend could still be open.

/** Old path prefix for seal images, used inside already-published BCMR registries. */
export const LEGACY_MEDIA_PREFIX = 'stamps';
