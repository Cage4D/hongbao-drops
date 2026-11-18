// Link-preview tags for envelope pages (handoff §9). Rendered on the server by middleware.ts,
// because Telegram, WhatsApp and X fetch the page without running JavaScript.
// Pure functions, no DOM: this runs in Vercel's edge runtime.

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
