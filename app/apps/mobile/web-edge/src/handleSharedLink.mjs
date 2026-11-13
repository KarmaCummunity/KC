// The request handler behind `/post/:id` and `/user/:handle` on Cloudflare Pages.
//
// Cloudflare runs it before the static assets, so it only decides what to do with the request:
// answer a preview crawler with an Open Graph card, send a phone browser without the app to the
// store, or hand the request on (`next`) so the SPA is served exactly as before.

import { resolveConfig } from './config.mjs';
import { decideSharedLinkAction } from './sharedLinkPolicy.mjs';
import { buildGenericCard, buildPostCard, buildProfileCard } from './ogCard.mjs';
import { renderOgHtml } from './ogHtml.mjs';
import { fetchSharedPost } from './postRepository.mjs';

/** Share handles are short slugs; anything else is not a profile link we should echo. */
const HANDLE = /^[A-Za-z0-9._-]{1,64}$/;

/** The answer depends on the User-Agent, so no shared cache may serve one visitor's answer to another. */
const VARY = { vary: 'User-Agent' };

// Function responses do not get the static `_headers` file, so the card carries its own baseline.
const OG_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=300',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  ...VARY,
};

/** The card for a link: the post's own, a generic profile card, or the brand card when unreadable. */
async function cardFor(kind, param, config, fetchImpl) {
  if (kind === 'post') {
    const row = await fetchSharedPost(param, config, fetchImpl);
    return row ? buildPostCard(row, config) : buildGenericCard(config);
  }
  return HANDLE.test(param) ? buildProfileCard(config) : buildGenericCard(config);
}

/**
 * @param {{ kind: 'post' | 'user', param: string, request: Request, env?: Record<string, unknown>,
 *           next: () => Promise<Response>, fetchImpl?: typeof fetch }} input
 */
export async function handleSharedLink({ kind, param, request, env, next, fetchImpl = globalThis.fetch }) {
  const config = resolveConfig(env);
  const url = new URL(request.url);
  const action = decideSharedLinkAction({
    userAgent: request.headers.get('user-agent'),
    search: url.searchParams,
    storeLinks: config.storeLinks,
  });

  if (action.kind === 'og') {
    const card = await cardFor(kind, param, config, fetchImpl);
    const canonical = `${config.appBaseUrl}/${kind === 'post' ? 'post' : 'user'}/${encodeURIComponent(param)}`;
    return new Response(renderOgHtml(card, canonical), { status: 200, headers: OG_HEADERS });
  }
  if (action.kind === 'store') {
    return new Response(null, { status: 302, headers: { location: action.url, 'cache-control': 'no-store', ...VARY } });
  }
  const response = await next();
  // The SPA body is the same for everyone, but the headers must say the choice depended on the UA.
  const passthrough = new Response(response.body, response);
  passthrough.headers.append('vary', 'User-Agent');
  return passthrough;
}
