// Vercel Routing Middleware: link previews for envelope URLs (handoff §9).
//
// Crawlers (Telegram, WhatsApp, X, …) fetch /e/<id> and /<slug> without running JavaScript, so the
// og:/twitter: tags must be in the HTML. Here we look the envelope up and serve index.html with
// them filled in. The #k= link secret is a URL fragment: browsers never send it, so it can't reach
// this code or a preview.
//
// It must never slow down or break a claim: on any problem (API slow or down, unknown envelope,
// unexpected HTML) it falls through to the normal static page.
import { next } from '@vercel/functions';
import { injectPreview, type PreviewView } from './src/lib/ogMeta';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const API_URL = (env.VITE_API_URL || 'https://hongbao-drops-api.vercel.app').replace(/\/$/, '');
const TIMEOUT_MS = 1500;
/** Slugs: 6 chars from the API's alphabet (no 0/o/1/l/i). */
const SLUG = /^\/([23456789abcdefghjkmnpqrstuvwxyz]{6})\/?$/;
const ENV_ID = /^\/e\/([a-z0-9]{8,40})\/?$/;

export const config = {
  matcher: ['/e/:id', '/:slug([23456789abcdefghjkmnpqrstuvwxyz]{6})'],
};

export default async function middleware(request: Request): Promise<Response> {
  if (request.method !== 'GET') return next();
  const url = new URL(request.url);
  const id = url.pathname.match(ENV_ID)?.[1];
  const slug = id ? undefined : url.pathname.match(SLUG)?.[1];
  if (!id && !slug) return next();

  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const [viewRes, pageRes] = await Promise.all([
      fetch(id ? `${API_URL}/envelopes/${id}` : `${API_URL}/s/${slug}`, { signal, headers: { accept: 'application/json' } }),
      fetch(new URL('/index.html', url), { signal }),
    ]);
    if (!viewRes.ok || !pageRes.ok) return next();
    const view = (await viewRes.json()) as PreviewView;
    const html = injectPreview(await pageRes.text(), view, `${url.origin}${url.pathname}`);
    if (!html) return next();
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Shares left / amount change; the card image itself is cached 60 s by the API.
        'cache-control': 'public, max-age=0, must-revalidate',
        'x-hongbao-preview': '1',
      },
    });
  } catch {
    return next();
  }
}
