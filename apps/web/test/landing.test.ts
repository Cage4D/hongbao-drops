// Landing page logic: the hero buttons switch on VITE_DEMO_URL, and the counters hide while small.
import { describe, expect, it } from 'vitest';
import { MIN_ENVELOPES_FOR_STATS, heroCtas, statsMode } from '../src/pages/Landing';

describe('hero buttons', () => {
  it('without a demo envelope: Send a drop leads, nothing extra', () => {
    const c = heroCtas('');
    expect(c.primary).toEqual({ label: 'Send a drop', to: '/send', external: false });
    expect(c.secondary).toEqual({ label: 'How it works', to: '/#how', external: false });
    expect(c.note).toBeNull();
  });
  it('with a demo envelope: Try it free opens it, Send your own is secondary, plus the reassurance line', () => {
    const demo = 'https://hongbao-drops.vercel.app/k7m2qp#k=L1abc';
    const c = heroCtas(demo);
    expect(c.primary).toEqual({ label: 'Try it free', to: demo, external: true });
    expect(c.secondary).toEqual({ label: 'Send your own', to: '/send', external: false });
    expect(c.note).toBe('No BCH needed. All you need is a BCH wallet, like Paytaca.');
  });
});

describe('hero counters', () => {
  it('show nothing while loading or after a failed load', () => {
    expect(statsMode(null, 'MAINNET')).toBe('none');
    expect(statsMode(null, null)).toBe('none');
  });
  it(`hide below ${MIN_ENVELOPES_FOR_STATS} envelopes: a neutral line on mainnet, nothing on the test network`, () => {
    expect(statsMode({ envelopes: 0 }, 'MAINNET')).toBe('line');
    expect(statsMode({ envelopes: MIN_ENVELOPES_FOR_STATS - 1 }, 'MAINNET')).toBe('line');
    expect(statsMode({ envelopes: 0 }, 'CHIPNET')).toBe('none');
    expect(statsMode({ envelopes: 2 }, null)).toBe('none');
  });
  it(`show the numbers from ${MIN_ENVELOPES_FOR_STATS} envelopes`, () => {
    expect(statsMode({ envelopes: MIN_ENVELOPES_FOR_STATS }, 'MAINNET')).toBe('numbers');
    expect(statsMode({ envelopes: 26 }, 'CHIPNET')).toBe('numbers');
  });
});
