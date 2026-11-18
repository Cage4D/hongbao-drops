// What this device remembers about envelopes (localStorage, this origin only).
// Link secrets live here only inside SentDrop.url, for the sender's own drops.
import type { Theme } from '@hongbao/shared';
import type { ClaimResult } from './claim';
import { store } from './storage';
import { upgradeStoredClaim } from './legacy';

export const claimKey = (envelopeId: string) => `hongbao:claim:${envelopeId}`;
export const holdKey = (envelopeId: string) => `hongbao:hold:${envelopeId}`;
export const SENT_KEY = 'hongbao:sent';

export interface PassedOn {
  id: string;
  slug: string;
  /** Share link of the new envelope (with its #k=), when this device made it. */
  url?: string;
}

export type StoredClaim = ClaimResult & { passedOn?: PassedOn };

/** The claim this device made on an envelope, if any (older saves are upgraded on read). */
export const readClaim = (envelopeId: string) => upgradeStoredClaim(store.get<StoredClaim>(claimKey(envelopeId)));

export interface SentDrop {
  id: string;
  slug: string;
  url: string;
  totalSats: number;
  shareCount: number;
  theme: Theme;
  message?: string;
  createdAt: string;
  parent?: string;
}

export const sentDrops = () => store.get<SentDrop[]>(SENT_KEY) ?? [];

/** Record that the share claimed from `parentId` was passed on as `child`. */
export function markPassedOn(parentId: string, child: PassedOn) {
  const c = readClaim(parentId);
  if (c) store.set(claimKey(parentId), { ...c, passedOn: child });
}

/** Where to open an envelope this device knows about: the full link if we have it. */
export function envelopeHref(id: string, slug?: string): string {
  const mine = sentDrops().find((d) => d.id === id);
  if (mine) return mine.url.replace(location.origin, '');
  return slug ? `/${slug}` : `/e/${id}`;
}
