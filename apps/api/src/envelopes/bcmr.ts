// BCMR registry for an envelope's stamp collection (CHIP-BCMR v2).
// Generated ONCE at envelope creation: its sha256 goes into the funding tx's OP_RETURN, so these
// exact bytes are stored and must be served verbatim forever (Phase 6: GET /bcmr/:category.json).
import { binToHex } from '@bitauth/libauth';
import { bcmrRegistryHash, stampCommitment } from '@hongbao/contract';

export interface BcmrInput {
  category: string;
  envelopeSeq: number;
  shareCount: number;
  theme: string;
  message?: string | null;
  sponsorName?: string | null;
  publicApiUrl: string;
  createdAt: Date;
}

export function buildBcmrRegistry(i: BcmrInput): { json: string; hash: string; uri: string } {
  const api = i.publicApiUrl.replace(/\/$/, '');
  const ts = i.createdAt.toISOString();
  const brand = i.sponsorName ? `${i.sponsorName} ` : '';
  const types: Record<string, unknown> = {};
  for (let s = 1; s <= i.shareCount; s++) {
    const commitment = binToHex(stampCommitment(i.envelopeSeq, s));
    types[commitment] = {
      name: `${brand}Hongbao Stamp #${i.envelopeSeq}-${s}`,
      description: `Share ${s} of ${i.shareCount}, caught from red envelope #${i.envelopeSeq}.`,
      uris: {
        // PNG: not every wallet renders SVG icons (Phase 6). /stamps/…/*.svg is served too.
        icon: `${api}/stamps/${i.category}/${commitment}.png`,
        image: `${api}/stamps/${i.category}/${commitment}.png`,
      },
    };
  }
  const registry = {
    $schema: 'https://cashtokens.org/bcmr-v2.schema.json',
    version: { major: 1, minor: 0, patch: 0 },
    latestRevision: ts,
    registryIdentity: {
      name: 'Hongbao Drops',
      description: 'Red envelopes of BCH. Every claimer gets a stamp proving they caught it.',
      uris: { web: api },
    },
    identities: {
      // Authbase = the tx whose output 0 the funding tx spends = the token category (findings §5).
      [i.category]: {
        [ts]: {
          name: `${brand}Hongbao Stamps #${i.envelopeSeq}`,
          description: i.message?.slice(0, 280) || `Stamps from Hongbao red envelope #${i.envelopeSeq} (${i.theme}).`,
          token: {
            category: i.category,
            symbol: 'HONGBAO',
            nfts: {
              description: 'Collectible proof you caught a share of a Hongbao red envelope.',
              parse: { types },
            },
          },
          uris: { icon: `${api}/stamps/${i.category}/collection.png`, web: api },
        },
      },
    },
  };
  const json = JSON.stringify(registry);
  return {
    json,
    hash: binToHex(bcmrRegistryHash(new TextEncoder().encode(json))),
    uri: `${api.replace(/^https?:\/\//, '')}/bcmr/${i.category}.json`,
  };
}
