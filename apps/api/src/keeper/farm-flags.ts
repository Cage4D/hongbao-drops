// Suspected-farm heuristics (spec §4). Flag, don't block — sponsors decide what to do with them.
// Pure function over a group of claims (one campaign, or one envelope when there's no campaign).

export type FarmReason = 'SAME_FINGERPRINT' | 'IP_BURST' | 'COMMON_SWEEP' | 'NEVER_USED';

export interface FarmClaimInput {
  id: string;
  createdAt: Date;
  walletFingerprint: string | null;
  ipHash: string | null;
  recipientLockingBytecode: string;
  sweptTo: string[];
  /** false once 7 days passed without the coins moving or a pass-on; null = not decided yet. */
  activatedWithin7d: boolean | null;
}

export const IP_BURST_COUNT = 3;
export const IP_BURST_WINDOW_MS = 60_000;

export function farmFlags(claims: FarmClaimInput[]): Map<string, FarmReason[]> {
  const out = new Map<string, FarmReason[]>(claims.map((c) => [c.id, []]));
  const flag = (id: string, r: FarmReason) => {
    const list = out.get(id)!;
    if (!list.includes(r)) list.push(r);
  };

  // SAME_FINGERPRINT: one wallet (xpub hash) claiming more than once across the group.
  const byFp = groupBy(claims.filter((c) => c.walletFingerprint), (c) => c.walletFingerprint!);
  for (const group of byFp.values()) if (group.length > 1) group.forEach((c) => flag(c.id, 'SAME_FINGERPRINT'));

  // IP_BURST: ≥ 3 claims within 60 s from one IP hash.
  const byIp = groupBy(claims.filter((c) => c.ipHash), (c) => c.ipHash!);
  for (const group of byIp.values()) {
    const sorted = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i + IP_BURST_COUNT - 1 < sorted.length; i++) {
      const window = sorted.slice(i, i + IP_BURST_COUNT);
      if (window[window.length - 1]!.createdAt.getTime() - window[0]!.createdAt.getTime() <= IP_BURST_WINDOW_MS) {
        window.forEach((c) => flag(c.id, 'IP_BURST'));
      }
    }
  }

  // COMMON_SWEEP: claimed coins sent to an address that also collected other claims of the group
  // (another claim's sweep destination, or another claimer's own address).
  const recipients = new Map(claims.map((c) => [c.recipientLockingBytecode, c.id]));
  const sweepCount = new Map<string, Set<string>>();
  for (const c of claims) for (const dest of new Set(c.sweptTo)) {
    if (!sweepCount.has(dest)) sweepCount.set(dest, new Set());
    sweepCount.get(dest)!.add(c.id);
  }
  for (const c of claims) {
    for (const dest of c.sweptTo) {
      const others = [...(sweepCount.get(dest) ?? [])].filter((id) => id !== c.id);
      const intoOtherClaimer = recipients.has(dest) && recipients.get(dest) !== c.id;
      if (others.length > 0 || intoOtherClaimer) {
        flag(c.id, 'COMMON_SWEEP');
        others.forEach((id) => flag(id, 'COMMON_SWEEP'));
        if (intoOtherClaimer) flag(recipients.get(dest)!, 'COMMON_SWEEP');
      }
    }
  }

  // NEVER_USED: 7 days on, the coins never moved and the claimer never passed it on.
  for (const c of claims) if (c.activatedWithin7d === false) flag(c.id, 'NEVER_USED');
  return out;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}
