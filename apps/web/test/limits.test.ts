// The site shows the server's own per-envelope limits (GET /health), not built-in numbers.
import { describe, expect, it } from 'vitest';
import { NETS, withLimits } from '../src/lib/network';

describe('withLimits', () => {
  it('takes the server limits over the mainnet fallbacks', () => {
    const cfg = withLimits(NETS.MAINNET, { maxShares: 20, maxEnvelopeUsd: 20, maxEnvelopeSats: 12_000_000, maxExpirySec: 86_400 });
    expect(cfg).toMatchObject({ network: 'MAINNET', maxShares: 20, maxUsd: 20, maxSats: 12_000_000, maxExpirySec: 86_400 });
  });
  it('keeps the fallbacks when the server sends none', () => {
    expect(withLimits(NETS.MAINNET, null)).toBe(NETS.MAINNET);
    expect(withLimits(NETS.CHIPNET, undefined).maxUsd).toBeNull();
  });
});
