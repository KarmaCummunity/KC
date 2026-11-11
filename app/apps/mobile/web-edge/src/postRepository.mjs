// Reads the public facts of a post that a link-preview card needs, through the database function
// `post_share_card` (migration 0025) with the anon key. Signed-out callers cannot read `posts`,
// so the function is the one door: it returns a row only for a public, open or delivered post of
// an active member, and only the columns below. No direct table read happens here.

import { trimTrailingSlashes } from './config.mjs';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const REST_TIMEOUT_MS = 2000;

export function isPostId(value) {
  return UUID.test(value);
}

/**
 * @returns the card row, or null when there is nothing safe to show (not configured, invalid id,
 *          no such public post, slow or failing backend). Never throws.
 */
export async function fetchSharedPost(postId, { supabaseUrl, supabaseAnonKey }, fetchImpl) {
  if (!isPostId(postId) || !supabaseUrl || !supabaseAnonKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${trimTrailingSlashes(supabaseUrl)}/rest/v1/rpc/post_share_card`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        authorization: `Bearer ${supabaseAnonKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_post_id: postId }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return row && typeof row.title === 'string' && row.title.trim() !== '' ? row : null;
  } catch (err) {
    // Timeouts, network failures and non-JSON bodies all mean "no card" — never throw to the edge.
    console.warn('[web-edge] post_share_card failed', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
