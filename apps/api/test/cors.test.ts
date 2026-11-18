// Phase 9: CORS answers browsers only on the frontend's origins; public media stays open.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowedOrigins, isAllowedOrigin } from '../src/common/cors.js';
import { makeApp } from './helpers.js';

describe('allowed origins', () => {
  const allowed = allowedOrigins({ CORS_ORIGINS: 'https://drops.example.com/, https://other.example' });
  it.each([
    'https://hongbao-drops.vercel.app',
    'https://hongbao-drops-cage4ds-projects.vercel.app',
    'https://hongbao-drops-git-main-cage4ds-projects.vercel.app',
    'https://hongbao-drops-n6tif43pm-cage4ds-projects.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
    'https://drops.example.com',
    'https://other.example',
  ])('allows %s', (o) => expect(isAllowedOrigin(o, allowed)).toBe(true));
  it.each([
    'https://evil.example',
    'https://hongbao-drops.vercel.app.evil.example',
    'http://hongbao-drops.vercel.app',
    'https://hongbao-drops-x-someoneelse.vercel.app',
    'https://localhost.evil.example',
  ])('refuses %s', (o) => expect(isAllowedOrigin(o, allowed)).toBe(false));
});

describe('CORS headers', () => {
  let t: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => (t = await makeApp()));
  afterAll(async () => t.app.close());

  it('reflects the frontend origin on API calls', async () => {
    const r = await t.http().get('/stats/global').set('Origin', 'https://hongbao-drops.vercel.app');
    expect(r.headers['access-control-allow-origin']).toBe('https://hongbao-drops.vercel.app');
  });

  it('answers a preflight from the frontend for a JSON POST', async () => {
    const r = await t
      .http()
      .options('/envelopes')
      .set('Origin', 'https://hongbao-drops.vercel.app')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(r.status).toBeLessThan(300);
    expect(r.headers['access-control-allow-origin']).toBe('https://hongbao-drops.vercel.app');
    expect(r.headers['access-control-allow-headers']).toMatch(/content-type/);
  });

  it('gives other sites no CORS headers on API calls', async () => {
    const r = await t.http().get('/stats/global').set('Origin', 'https://evil.example');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps /health open to any site', async () => {
    const r = await t.http().get('/health').set('Origin', 'https://evil.example');
    expect(r.headers['access-control-allow-origin']).toBe('*');
  });
});
