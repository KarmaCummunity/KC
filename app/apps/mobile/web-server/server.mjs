// FR-POST-023 — Hono server that replaces `serve dist --single`.
// One canonical URL: https://karma-community-kc.com/post/<id>.
//
// Behaviour:
//   - GET /post/:id from a crawler UA  →  200 text/html OG stub built from a
//     Supabase REST read (anon key, RLS-gated). Two-second
//     timeout; falls back to generic card on miss/failure.
//   - GET /post/:id from a human UA    →  200 text/html with the SPA index.
//   - Everything else                  →  static file from dist/ if present,
//                                          else SPA fallback to index.html.
//
// No Supabase domain ever appears in user-visible responses. The OG `og:url`
// + canonical link are always APP_BASE_URL/post/<id>.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Strip trailing `/` characters without a backtracking regex. */
function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}


const here = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = process.env.WEB_DIST_DIR ?? resolve(here, 'dist');

// User-facing copy lives in locale JSON bundles, never inline (D-24 / TD-154).
const SERVER_LOCALE = process.env.WEB_SERVER_LOCALE ?? 'he';
const SERVER_STRINGS = JSON.parse(
  readFileSync(resolve(here, 'i18n', `${SERVER_LOCALE}.json`), 'utf8'),
);

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'https://karma-community-kc.com';
const APP_NAME = SERVER_STRINGS.appName;
const APP_TAGLINE = SERVER_STRINGS.appTagline;
const STORAGE_BUCKET = 'post-images';
const FALLBACK_OG_IMAGE = `${APP_BASE_URL}/pwa-icon-512.png`;
const REST_TIMEOUT_MS = 2000;

const BOT_UA = /facebookexternalhit|WhatsApp|Twitterbot|TelegramBot|Slackbot|LinkedInBot|SkypeUriPreview|Discordbot|Applebot|googlebot|bingbot|Pinterest|redditbot|Embedly|vkShare/i;
const POST_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const OG_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=300',
  'x-content-type-options': 'nosniff',
};

function escapeHtml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function truncate(s, max) {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function publicMediaUrl(path) {
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  return `${trimTrailingSlashes(SUPABASE_URL)}/storage/v1/object/public/${STORAGE_BUCKET}/${trimmed}`;
}

function renderOgHtml({ title, description, imageUrl, canonicalUrl }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImage = escapeHtml(imageUrl);
  const safeCanonical = escapeHtml(canonicalUrl);
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<meta name="description" content="${safeDescription}" />
<link rel="canonical" href="${safeCanonical}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="${escapeHtml(APP_NAME)}" />
<meta property="og:title" content="${safeTitle}" />
<meta property="og:description" content="${safeDescription}" />
<meta property="og:image" content="${safeImage}" />
<meta property="og:image:alt" content="${safeTitle}" />
<meta property="og:url" content="${safeCanonical}" />
<meta property="og:locale" content="he_IL" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${safeTitle}" />
<meta name="twitter:description" content="${safeDescription}" />
<meta name="twitter:image" content="${safeImage}" />
</head>
<body>
<noscript><a href="${safeCanonical}">${safeTitle}</a></noscript>
</body>
</html>`;
}

function renderGenericOg(canonicalUrl) {
  return renderOgHtml({
    title: APP_NAME,
    description: APP_TAGLINE,
    imageUrl: FALLBACK_OG_IMAGE,
    canonicalUrl,
  });
}

async function fetchPostForShare(postId, fetchImpl) {
  if (!POST_UUID.test(postId)) return null;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const url =
    `${trimTrailingSlashes(SUPABASE_URL)}/rest/v1/posts` +
    `?select=post_id,title,description,visibility,status,media_assets(path,ordinal)` +
    `&post_id=eq.${encodeURIComponent(postId)}` +
    `&limit=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REST_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        accept: 'application/json',
      },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    const media = Array.isArray(row.media_assets) ? row.media_assets : [];
    const first = media.slice().sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))[0];
    return {
      title: row.title,
      description: row.description ?? '',
      firstMediaPath: first?.path ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readIndexHtml() {
  return readFile(resolve(DIST_DIR, 'index.html'), 'utf8');
}

export function createApp({ fetch: fetchImpl } = {}) {
  const f = fetchImpl ?? globalThis.fetch;
  const app = new Hono();

  app.get('/post/:id', async (c) => {
    const id = c.req.param('id');
    const ua = c.req.header('user-agent') ?? '';
    const canonicalUrl = `${APP_BASE_URL}/post/${encodeURIComponent(id)}`;
    if (!BOT_UA.test(ua)) {
      return c.html(await readIndexHtml());
    }
    if (!POST_UUID.test(id)) {
      return new Response(renderGenericOg(canonicalUrl), { status: 200, headers: OG_HEADERS });
    }
    const post = await fetchPostForShare(id, f);
    if (!post) {
      return new Response(renderGenericOg(canonicalUrl), { status: 200, headers: OG_HEADERS });
    }
    const imageUrl = post.firstMediaPath ? publicMediaUrl(post.firstMediaPath) : FALLBACK_OG_IMAGE;
    const body = renderOgHtml({
      title: truncate(post.title, 70),
      description: truncate((post.description || APP_TAGLINE).trim(), 200),
      imageUrl,
      canonicalUrl,
    });
    return new Response(body, { status: 200, headers: OG_HEADERS });
  });

  app.use('/*', serveStatic({ root: DIST_DIR }));
  app.get('*', async (c) => c.html(await readIndexHtml()));

  return app;
}

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`[web-server] listening on :${port}, serving ${DIST_DIR}`);
}
