// Link previews (middleware.ts), with the network mocked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicEnvelopeView } from '@hongbao/shared';
import middleware, { config, injectPreview, previewText } from '../middleware';

const INDEX = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

const view = (over: Partial<PublicEnvelopeView> = {}): PublicEnvelopeView => ({
  id: 'cmabc123def456',
  slug: 'k7m2qp',
  network: 'CHIPNET',
  status: 'ACTIVE',
  mode: 'LUCKY',
  theme: 'lunar',
  message: 'Happy Lunar New Year!',
  quizQuestion: null,
  sponsor: null,
  total: { sats: 20_000, usd: 0.04 },
  remaining: { sats: 12_000, usd: 0.025 },
  shares: { total: 5, claimed: 2, left: 3 },
  expiry: 1_900_000_000,
  secondsLeft: 3600,
  withSeals: true,
  seal: null,
  og: { imageUrl: 'https://hongbao-drops-api.vercel.app/og/k7m2qp.png', alt: 'A red envelope: 3 of 5 left', width: 1200, height: 630 },
  recentClaims: [],
  fundingTxid: null,
  parentEnvelopeId: null,
  ...over,
});

/** fetch mock: the API answers with `apiBody`/`apiStatus`, the site with index.html. */
function mockFetch(apiBody: unknown, apiStatus = 200, delayMs = 0) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const u = String(input);
      calls.push(u);
      if (u.endsWith('/index.html')) return new Response(INDEX, { headers: { 'content-type': 'text/html' } });
      if (delayMs)
        await new Promise((res, rej) => {
          const t = setTimeout(res, delayMs);
          init?.signal?.addEventListener('abort', () => (clearTimeout(t), rej(new DOMException('aborted', 'AbortError'))));
        });
      return new Response(JSON.stringify(apiBody), { status: apiStatus, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}
const isPassThrough = (r: Response) => r.headers.get('x-middleware-next') === '1';
const meta = (html: string, key: string) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];

afterEach(() => vi.unstubAllGlobals());

describe('preview text', () => {
  it('follows the handoff: message · N of M left · $remaining', () => {
    expect(previewText(view())).toEqual({ title: '🧧 A red envelope for you', description: 'Happy Lunar New Year! · 3 of 5 left · $0.03' });
  });
  it('names the sponsor', () => {
    const s = { name: 'Acme', logoUrl: null, brandColor: null, ctaLabel: null, ctaUrl: null };
    expect(previewText(view({ sponsor: s })).title).toBe('🧧 A red envelope from Acme');
  });
  it.each([
    [{ status: 'EXHAUSTED', shares: { total: 5, claimed: 5, left: 0 } }, 'All grabbed'],
    [{ status: 'EXPIRED' }, 'This envelope has closed'],
    [{ status: 'REFUNDED' }, 'This envelope has closed'],
    [{ status: 'PENDING_FUNDING' }, 'Being sealed'],
  ] as const)('says when it is not open (%o)', (over, text) => {
    expect(previewText(view(over as Partial<PublicEnvelopeView>)).description).toBe(`Happy Lunar New Year! · ${text}`);
  });
  it('leaves out an unknown price', () => {
    expect(previewText(view({ message: null, remaining: { sats: 1, usd: null } })).description).toBe('3 of 5 left');
  });
});

describe('injectPreview', () => {
  it('escapes HTML in user text', () => {
    const html = injectPreview(INDEX, view({ message: '"><script>alert(1)</script>' }), 'https://x.test/k7m2qp')!;
    expect(html).not.toContain('<script>alert');
    expect(meta(html, 'og:description')).toContain('&quot;&gt;&lt;script&gt;');
  });
  it('replaces the default tags and keeps one description', () => {
    const html = injectPreview(INDEX, view(), 'https://x.test/k7m2qp')!;
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html).toContain('<script type="module"');
  });
  it('gives up when the markers are missing', () => {
    expect(injectPreview('<html><head></head></html>', view(), 'https://x.test/')).toBeNull();
  });
});

describe('middleware', () => {
  it('fills the tags for a short link', async () => {
    const calls = mockFetch(view());
    const r = await middleware(new Request('https://hongbao-drops.vercel.app/k7m2qp'));
    expect(r.headers.get('x-hongbao-preview')).toBe('1');
    const html = await r.text();
    expect(meta(html, 'og:title')).toBe('🧧 A red envelope for you');
    expect(meta(html, 'og:image')).toBe('https://hongbao-drops-api.vercel.app/og/k7m2qp.png');
    expect(meta(html, 'og:image:alt')).toBe('A red envelope: 3 of 5 left');
    expect(meta(html, 'twitter:card')).toBe('summary_large_image');
    expect(meta(html, 'og:url')).toBe('https://hongbao-drops.vercel.app/k7m2qp');
    expect(calls).toContain('https://hongbao-drops-api.vercel.app/s/k7m2qp');
  });
  it('fills the tags for /e/:id and never puts a query in og:url', async () => {
    const calls = mockFetch(view());
    const html = await (await middleware(new Request('https://hongbao-drops.vercel.app/e/cmabc123def456?utm=x'))).text();
    expect(meta(html, 'og:url')).toBe('https://hongbao-drops.vercel.app/e/cmabc123def456');
    expect(calls).toContain('https://hongbao-drops-api.vercel.app/envelopes/cmabc123def456');
  });
  it('passes through for an unknown envelope', async () => {
    mockFetch({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
    expect(isPassThrough(await middleware(new Request('https://hongbao-drops.vercel.app/k7m2qp')))).toBe(true);
  });
  it('passes through when the API is slow, within the timeout', async () => {
    mockFetch(view(), 200, 5000);
    const t0 = Date.now();
    const r = await middleware(new Request('https://hongbao-drops.vercel.app/k7m2qp'));
    expect(isPassThrough(r)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2500);
  });
  it('ignores paths that are not envelopes', async () => {
    const calls = mockFetch(view());
    expect(isPassThrough(await middleware(new Request('https://hongbao-drops.vercel.app/sponsor')))).toBe(true);
    expect(isPassThrough(await middleware(new Request('https://hongbao-drops.vercel.app/abc1l0')))).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it('only matches envelope routes', () => {
    expect(config.matcher).toEqual(['/e/:id', '/:slug([23456789abcdefghjkmnpqrstuvwxyz]{6})']);
  });
});
