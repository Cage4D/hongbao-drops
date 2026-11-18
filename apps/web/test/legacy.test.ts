// Claims saved on a device before the "Hongbao Seals" rename still show their seal.
import { describe, expect, it } from 'vitest';
import { upgradeStoredClaim } from '../src/lib/legacy';

const seal = { category: 'ab', commitment: 'cd', imageUrl: 'https://x/seals/ab/cd.png', alt: 'a seal' };

describe('upgradeStoredClaim', () => {
  it('moves the pre-rename key to `seal`', () => {
    const old = JSON.parse(`{"txid":"t","st${'amp'}":${JSON.stringify(seal)}}`) as { txid: string; seal?: unknown };
    expect(upgradeStoredClaim(old)?.seal).toEqual(seal);
  });
  it('leaves new and empty saves alone', () => {
    const now = { txid: 't', seal };
    expect(upgradeStoredClaim(now)).toBe(now);
    expect(upgradeStoredClaim({ txid: 't', seal: null })?.seal).toBeNull();
    expect(upgradeStoredClaim(null)).toBeNull();
  });
});
