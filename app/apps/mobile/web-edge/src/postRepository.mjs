// Reads the few public columns of a post that a link-preview card needs, over PostgREST with the
// anon key. Row-level security decides what the anon role may see; the explicit filters below are
// a second fence, so a hidden, removed or private post can never reach a card even if a policy
// is loosened later.

import { trimTrailingSlashes } from './config.mjs';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const REST_TIMEOUT_MS = 2000;
const COLUMNS = 'title,description,type,status,world_slug,city,media_assets(path,bucket,ordinal)';

export function isPostId(value) {
  return UUID.test(value);
}

/**
 * @returns the row, or null when there is nothing safe to show (not configured, invalid id,
 *          hidden by RLS, not found, slow or failing backend). Never throws.
 */
export async function fetchSharedPost(postId, { supabaseUrl, supabaseAnonKey }, fetchImpl) {
  if (!isPostId(postId) || !supabaseUrl || !supabaseAnonKey) return null;
  const url =
    `${trimTrailingSlashes(supabaseUrl)}/rest/v1/posts?select=${COLUMNS}` +
    `&post_id=eq.${encodeURIComponent(postId)}` +
    '&visibility=eq.Public&status=in.(open,closed_delivered)&limit=1';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { apikey: supabaseAnonKey, authorization: `Bearer ${supabaseAnonKey}`, accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return row && typeof row.title === 'string' && row.title.trim() !== '' ? row : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
