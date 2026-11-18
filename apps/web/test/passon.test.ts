import { describe, expect, it } from 'vitest';
import { passOnDefaults } from '../src/lib/fund';

describe('passOnDefaults (Pass it on fits the claimed share)', () => {
  it('a claimed 5,000-sat demo share (4,410 received) funds one seal share', () => {
    // Seen on mainnet: the old 6,000 sats × 3 default asked a new wallet for more than it held.
    expect(passOnDefaults(4410)).toEqual({ shareCount: 1, sats: 2400 });
  });
  it('bigger claims split into more shares, each at least 2,000 sats', () => {
    const d = passOnDefaults(12_000);
    expect(d.shareCount).toBe(3);
    expect(d.sats / d.shareCount).toBeGreaterThanOrEqual(2000);
    expect(d.sats).toBeLessThan(12_000 - 546 - 766);
  });
  it('a claim too small to cover a share still suggests the minimum', () => {
    expect(passOnDefaults(1500)).toEqual({ shareCount: 1, sats: 2000 });
    expect(passOnDefaults(0)).toEqual({ shareCount: 1, sats: 2000 });
  });
});
