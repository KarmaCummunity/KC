import { readFile } from 'node:fs/promises';
import { anonKey, SUPABASE_URL } from './env';
import { fetchPasswordSession } from './supabaseSession';

type PasswordSession = Awaited<ReturnType<typeof fetchPasswordSession>>;

/** One sign-in per member and worker: a poll reads as the member many times a minute. */
const sessions = new Map<string, Promise<PasswordSession>>();

/** Seconds of validity a cached session must still have to be handed out again. */
const SESSION_MARGIN_S = 300;

/**
 * The member's password session, signed in once and reused until it nears expiry. A sign-in per
 * call put dozens of password hashes a minute on kc-dev's Auth, which answered some with a 504.
 * A failed sign-in is not kept, so the next call tries again.
 */
export async function sessionFor(user: { email: string; password: string }): Promise<PasswordSession> {
  const cached = await sessions.get(user.email)?.catch(() => undefined);
  const expiresAt = Number(cached?.session.expires_at ?? 0);
  if (cached && expiresAt - Date.now() / 1000 > SESSION_MARGIN_S) return cached;
  const fresh = fetchPasswordSession({ supabaseUrl: SUPABASE_URL, anonKey: await anonKey(), ...user });
  sessions.set(user.email, fresh);
  return fresh;
}

/** Drop a cached password session so the next call signs in again (e.g. after account restore). */
export function forgetSession(email: string): void {
  sessions.delete(email);
}

/** Authenticated PostgREST call as the given user. Throws with the server message on error. */
export async function rest<T = unknown>(
  accessToken: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: await anonKey(),
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${path}: ${data?.message ?? text}`);
  return data as T;
}

/**
 * Uploads the fixture photo into the user's own folder of the `post-images` bucket (the storage
 * policy admits a member only under `<user id>/`) and returns the object key.
 */
export async function uploadPostPhoto(accessToken: string, userId: string): Promise<string> {
  const key = `${userId}/e2e-${Date.now()}.png`;
  const file = await readFile(new URL('../fixtures/item.png', import.meta.url));
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/post-images/${key}`, {
    method: 'POST',
    headers: { apikey: await anonKey(), Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png' },
    body: file,
  });
  if (!res.ok) throw new Error(`photo upload ${res.status}: ${await res.text()}`);
  return key;
}

export const runTag = () => `[e2e ${new Date().toISOString().slice(0, 16)}]`;

/**
 * Best-effort removal of this user's e2e-tagged posts so test data never lingers in the
 * user-visible kc-dev feed, and never piles up to the open-post cap (20 per member,
 * `post_limit_exceeded`). On the baseline a member may DELETE only a draft
 * (policy posts_delete_owner_draft); a published post goes through the owner action
 * `delete_post`, which moves it to `deleted_no_recipient` (purged after 7 days).
 * Never throws; returns how many posts it removed.
 */
export async function cleanupE2eContent(user: { email: string; password: string }): Promise<number> {
  let removed = 0;
  try {
    const { session } = await sessionFor(user);
    const token = session.access_token as string;
    const me = (session.user as { id: string }).id;
    const tag = encodeURIComponent('[e2e*');
    const done = '(deleted_no_recipient,removed_admin)';
    const posts = await rest<{ id: string }[]>(
      token,
      `posts?select=id&owner_id=eq.${me}&title=like.${tag}&status=not.in.${done}`,
    ).catch(() => []);
    for (const { id } of posts) {
      const ok = await rest(token, 'rpc/delete_post', { method: 'POST', body: { p_post_id: id } })
        .then(() => true)
        .catch(() => false);
      if (ok) removed += 1;
    }
  } catch {
    // cleanup must never fail the suite
  }
  return removed;
}
