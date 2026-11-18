// Vercel Routing Middleware: link previews for envelope URLs (handoff §9).
//
// Crawlers (Telegram, WhatsApp, X, …) fetch /e/<id> and /<slug> without running JavaScript, so the
// og:/twitter: tags must be in the HTML. Here we look the envelope up and serve index.html with
// them filled in. The #k= link secret is a URL fragment: browsers never send it, so it can't reach
// this code or a preview.
//
// It must never slow down or break a claim: on any problem (API slow or down, unknown envelope,
// unexpected HTML) it falls through to the normal static page.
//
// Self-contained on purpose: Vercel runs the compiled middleware as unbundled Node ESM, so a
// relative import (or a package it didn't trace) fails at runtime and every envelope URL 500s.
// Keep this file free of imports.

/** Continue to the normal static page (what @vercel/functions' next() returns). */
const next = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

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

// ------------------------------------------------------------------ preview tags

/**
 * The fields of the API's PublicEnvelopeView (@hongbao/shared) that previews use. Declared here so
 * the middleware compiles on its own on Vercel, where the workspace packages' types aren't built.
 */
export interface PreviewView {
  status: string;
  message: string | null;
  sponsor: { name: string } | null;
  remaining: { usd: number | null };
  shares: { total: number; left: number };
  og: { imageUrl: string; alt: string; width: number; height: number };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export interface PreviewText {
  title: string;
  description: string;
}

export function previewText(v: PreviewView): PreviewText {
  const title = v.sponsor ? `🧧 A red envelope from ${oneLine(v.sponsor.name, 60)}` : '🧧 A red envelope for you';
  const parts: string[] = [];
  if (v.message) parts.push(oneLine(v.message, 140));
  if (v.status === 'ACTIVE' && v.shares.left > 0) {
    parts.push(`${v.shares.left} of ${v.shares.total} left`);
    if (v.remaining.usd != null) parts.push(`$${v.remaining.usd.toFixed(2)}`);
  } else if (v.status === 'ACTIVE' || v.status === 'EXHAUSTED') {
    parts.push('All grabbed');
  } else if (v.status === 'PENDING_FUNDING') {
    parts.push('Being sealed');
  } else {
    parts.push('This envelope has closed');
  }
  return { title, description: parts.join(' · ') };
}

/** The <head> tags. `pageUrl` must be origin + path only: never the #k= fragment or a query. */
export function previewTags(v: PreviewView, pageUrl: string): string {
  const { title, description } = previewText(v);
  const m = (attr: 'property' | 'name', key: string, value: string | number) => `<meta ${attr}="${key}" content="${esc(String(value))}" />`;
  return [
    m('property', 'og:type', 'website'),
    m('property', 'og:site_name', 'Hongbao Drops'),
    m('property', 'og:url', pageUrl),
    m('property', 'og:title', title),
    m('property', 'og:description', description),
    m('property', 'og:image', v.og.imageUrl),
    m('property', 'og:image:alt', v.og.alt),
    m('property', 'og:image:width', v.og.width),
    m('property', 'og:image:height', v.og.height),
    m('property', 'og:image:type', 'image/png'),
    m('name', 'twitter:card', 'summary_large_image'),
    m('name', 'twitter:title', title),
    m('name', 'twitter:description', description),
    m('name', 'twitter:image', v.og.imageUrl),
    m('name', 'twitter:image:alt', v.og.alt),
    m('name', 'description', description),
  ].join('\n    ');
}

/** Swaps the default tags between <!--og--> and <!--/og--> in index.html. Null if the markers are gone. */
export function injectPreview(html: string, v: PreviewView, pageUrl: string): string | null {
  const start = html.indexOf('<!--og-->');
  const end = html.indexOf('<!--/og-->');
  if (start < 0 || end < start) return null;
  // The page's generic description would be a duplicate; the envelope's goes in the og block.
  const head = html.slice(0, start).replace(/\s*<meta name="description"[^>]*>/, '');
  return `${head}<!--og-->\n    ${previewTags(v, pageUrl)}\n    ${html.slice(end)}`;
}
