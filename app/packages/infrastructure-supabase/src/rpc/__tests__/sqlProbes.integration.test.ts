// TD-41 SQL probes — integration tests for SECURITY DEFINER RPCs.
//
// Verifies:
//   (a) is_following(A,B): true for accepted follow_edge, false for pending
//       follow_request or missing edge.
//   (b) is_post_visible_to(post_row, viewer): FollowersOnly branch returns true
//       only when viewer has an accepted follow_edge to the post owner.
//
// Requires a live dev Supabase instance. Skip gracefully when env vars are
// absent — run locally after `source ~/.kc-dev-secrets.env`.
//
// All test data is scoped to random UUIDs and cleaned up in afterAll.

import { describe, it, expect, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.legacy.types';

// Opt into the local Supabase stack started by `supabase start` by setting
// CI_LOCAL_SUPABASE=true. ci-backend.yml sets it for the sqlProbes step
// (after `supabase start`); ci-frontend's `pnpm test:coverage` does NOT,
// so this file gracefully skips there.
// The service-role JWT below is Supabase CLI's documented default for the
// local stack and only works against 127.0.0.1 — safe to commit.
const LOCAL_DEFAULT_URL = 'http://127.0.0.1:54321';
const LOCAL_DEFAULT_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const USE_LOCAL_SUPABASE = process.env['CI_LOCAL_SUPABASE'] === 'true';

const SUPABASE_URL =
  process.env['SUPABASE_URL'] ??
  process.env['EXPO_PUBLIC_SUPABASE_URL'] ??
  (USE_LOCAL_SUPABASE ? LOCAL_DEFAULT_URL : undefined);

const SERVICE_KEY =
  process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? (USE_LOCAL_SUPABASE ? LOCAL_DEFAULT_SERVICE_KEY : undefined);

const SKIP = !SUPABASE_URL || !SERVICE_KEY;

type AdminClient = SupabaseClient<Database>;
type PostRow = Database['public']['Tables']['posts']['Row'];

const cleanupFns: Array<() => Promise<void>> = [];

function makeAdmin(): AdminClient {
  return createClient<Database>(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function seedUser(admin: AdminClient): Promise<string> {
  const email = `sqlprobe+${crypto.randomUUID().slice(0, 8)}@kc-test.invalid`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`seedUser: ${error?.message}`);
  const id = data.user.id;
  cleanupFns.push(() => admin.auth.admin.deleteUser(id).then(() => undefined));
  return id;
}

async function seedFollowEdge(admin: AdminClient, follower: string, followed: string) {
  const { error } = await admin.from('follow_edges').insert({ follower_id: follower, followed_id: followed });
  if (error) throw new Error(`seedFollowEdge: ${error.message}`);
  cleanupFns.push(async () => {
    await admin.from('follow_edges').delete().eq('follower_id', follower).eq('followed_id', followed);
  });
}

async function seedFollowRequest(admin: AdminClient, requester: string, target: string) {
  const { error } = await admin
    .from('follow_requests')
    .insert({ requester_id: requester, target_id: target, status: 'pending' });
  if (error) throw new Error(`seedFollowRequest: ${error.message}`);
  cleanupFns.push(async () => {
    await admin.from('follow_requests').delete().eq('requester_id', requester).eq('target_id', target);
  });
}

async function seedPost(admin: AdminClient, ownerId: string, visibility: string): Promise<PostRow> {
  const { data, error } = await admin
    .from('posts')
    .insert({
      owner_id: ownerId,
      type: 'Give',
      title: `TD-41 probe ${crypto.randomUUID().slice(0, 6)}`,
      status: 'open',
      visibility,
      // 'tel-aviv' is seeded by migration 0001; literal strings like 'Test'
      // violate posts_city_fkey -> cities(city_id).
      city: 'tel-aviv',
      street: 'Test',
      street_number: '1',
      location_display_level: 'CityOnly',
      category: 'Other',
    })
    .select()
    .single();
  if (error || !data) throw new Error(`seedPost: ${error?.message}`);
  cleanupFns.push(async () => {
    await admin.from('posts').delete().eq('post_id', data.post_id);
  });
  return data;
}

async function isFollowing(admin: AdminClient, follower: string, followed: string): Promise<boolean> {
  const { data, error } = await admin.rpc('is_following', { follower, followed });
  if (error) throw new Error(`is_following RPC: ${error.message}`);
  return data as boolean;
}

async function isPostVisibleTo(admin: AdminClient, post: PostRow, viewer: string): Promise<boolean> {
  const { data, error } = await admin.rpc('is_post_visible_to', { p_post: post, p_viewer: viewer });
  if (error) throw new Error(`is_post_visible_to RPC: ${error.message}`);
  return data as boolean;
}

describe.skipIf(SKIP)('SQL probes — is_following() and is_post_visible_to()', () => {
  // ── is_following() ────────────────────────────────────────────────────────

  it('returns true for an accepted follow_edge', async () => {
    const admin = makeAdmin();
    const [a, b] = await Promise.all([seedUser(admin), seedUser(admin)]);
    await seedFollowEdge(admin, a, b);
    expect(await isFollowing(admin, a, b)).toBe(true);
  });

  it('returns false when only a pending follow_request exists (no edge yet)', async () => {
    const admin = makeAdmin();
    const [a, b] = await Promise.all([seedUser(admin), seedUser(admin)]);
    await seedFollowRequest(admin, a, b);
    // follow_requests ≠ follow_edges — pending request must not satisfy is_following
    expect(await isFollowing(admin, a, b)).toBe(false);
  });

  it('returns false for the reverse direction of a unidirectional edge', async () => {
    const admin = makeAdmin();
    const [a, b] = await Promise.all([seedUser(admin), seedUser(admin)]);
    await seedFollowEdge(admin, a, b);
    expect(await isFollowing(admin, b, a)).toBe(false);
  });

  it('returns false for self-reference', async () => {
    const admin = makeAdmin();
    const a = await seedUser(admin);
    expect(await isFollowing(admin, a, a)).toBe(false);
  });

  // ── is_post_visible_to() — FollowersOnly branch ───────────────────────────

  it('FollowersOnly post visible to accepted follower', async () => {
    const admin = makeAdmin();
    const [owner, viewer] = await Promise.all([seedUser(admin), seedUser(admin)]);
    await seedFollowEdge(admin, viewer, owner);
    const post = await seedPost(admin, owner, 'FollowersOnly');
    expect(await isPostVisibleTo(admin, post, viewer)).toBe(true);
  });

  it('FollowersOnly post not visible to pending-request-only follower', async () => {
    const admin = makeAdmin();
    const [owner, viewer] = await Promise.all([seedUser(admin), seedUser(admin)]);
    await seedFollowRequest(admin, viewer, owner);
    const post = await seedPost(admin, owner, 'FollowersOnly');
    expect(await isPostVisibleTo(admin, post, viewer)).toBe(false);
  });

  it('FollowersOnly post not visible to a stranger', async () => {
    const admin = makeAdmin();
    const [owner, stranger] = await Promise.all([seedUser(admin), seedUser(admin)]);
    const post = await seedPost(admin, owner, 'FollowersOnly');
    expect(await isPostVisibleTo(admin, post, stranger)).toBe(false);
  });

  it('owner always sees their own FollowersOnly post', async () => {
    const admin = makeAdmin();
    const owner = await seedUser(admin);
    const post = await seedPost(admin, owner, 'FollowersOnly');
    expect(await isPostVisibleTo(admin, post, owner)).toBe(true);
  });

  // ─── cleanup ──────────────────────────────────────────────────────────────

  afterAll(async () => {
    for (const fn of cleanupFns.reverse()) {
      try { await fn(); } catch { /* best-effort */ }
    }
  });
});
