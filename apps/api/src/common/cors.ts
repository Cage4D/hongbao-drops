// CORS (Phase 9): the API answers browsers only on the frontend's origins, except for the
// read-only public files that wallets and other sites legitimately fetch from a browser.
//
// CORS only governs browsers. Servers, crawlers and wallet backends send no Origin header and are
// unaffected; it is not an auth layer (the rate limits and the one-share-per-claimer rules are).
import type { CorsOptions, CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import type { Request } from 'express';

/** The frontend: production, its Vercel aliases and preview deploys, and local dev. */
const DEFAULT_ORIGINS: (string | RegExp)[] = [
  'https://hongbao-drops.vercel.app',
  // hongbao-drops-cage4ds-projects.vercel.app, hongbao-drops-git-<branch>-…, hongbao-drops-<hash>-…
  /^https:\/\/hongbao-drops(-[a-z0-9-]+)?-cage4ds-projects\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

/** Public, read-only, safe for any site: stamp images, wallet metadata, preview cards, health. */
const OPEN_PATHS = /^\/(bcmr|stamps|og)\/|^\/health\/?$/;

/** Extra exact origins from CORS_ORIGINS (comma-separated), e.g. a custom domain. */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): (string | RegExp)[] {
  const extra = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}

export function isAllowedOrigin(origin: string, allowed: (string | RegExp)[]): boolean {
  return allowed.some((a) => (typeof a === 'string' ? a === origin : a.test(origin)));
}

/** Per-request CORS options for app.enableCors(). */
export function corsDelegate(env: NodeJS.ProcessEnv = process.env): CorsOptionsDelegate<Request> {
  const allowed = allowedOrigins(env);
  return (req, cb) => {
    const path = (req.path ?? req.url ?? '').split('?')[0] ?? '';
    const open: CorsOptions = { origin: '*', methods: ['GET', 'HEAD', 'OPTIONS'] };
    if (OPEN_PATHS.test(path)) return cb(null, open);
    const origin = req.headers.origin;
    const ok = typeof origin === 'string' && isAllowedOrigin(origin, allowed);
    cb(null, {
      // Reflect the allowed origin; anything else gets no CORS headers, so the browser blocks it.
      origin: ok ? origin : false,
      methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization', 'last-event-id'],
      maxAge: 600,
    });
  };
}
