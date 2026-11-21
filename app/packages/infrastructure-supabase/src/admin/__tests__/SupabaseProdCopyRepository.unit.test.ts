// FR-ADMIN-037 AC13 — the "Copied from production" adapter: RPC names, mapping of the jsonb
// answers, and refusals (a database without the tools, kc-prod, is `not_installed`).
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';
import { SupabaseProdCopyRepository } from '../SupabaseProdCopyRepository';

function repoWith(answer: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => answer);
  const client = { rpc } as unknown as SupabaseClient<Database>;
  return { repo: new SupabaseProdCopyRepository(client), rpc };
}

describe('SupabaseProdCopyRepository', () => {
  it('reads and maps the status', async () => {
    const { repo, rpc } = repoWith({
      data: { members: 200, posts: 685, organizations: 3, follows: 1600, saved_posts: 400,
              last_copied_at: '2026-11-21T20:45:00+00:00', is_dev_environment: true },
      error: null,
    });
    await expect(repo.getStatus()).resolves.toEqual({
      members: 200, posts: 685, organizations: 3, follows: 1600, savedPosts: 400,
      lastCopiedAt: '2026-11-21T20:45:00+00:00',
    });
    expect(rpc).toHaveBeenCalledWith('admin_prod_copy_status');
  });

  it('a copy that never ran answers zero counts and a null time', async () => {
    const { repo } = repoWith({
      data: { members: 0, posts: 0, organizations: 0, follows: 0, saved_posts: 0, last_copied_at: null }, error: null,
    });
    await expect(repo.getStatus()).resolves.toEqual({
      members: 0, posts: 0, organizations: 0, follows: 0, savedPosts: 0, lastCopiedAt: null,
    });
  });

  it('deletes the copy and maps what was deleted', async () => {
    const { repo, rpc } = repoWith({
      data: { members: 200, posts: 685, organizations: 3, follows: 1600, saved_posts: 400 }, error: null,
    });
    await expect(repo.deleteAll()).resolves.toEqual({ members: 200, posts: 685, organizations: 3 });
    expect(rpc).toHaveBeenCalledWith('admin_delete_prod_copy');
  });

  it('a database without the tools (kc-prod) refuses as not_installed', async () => {
    const { repo } = repoWith({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.admin_prod_copy_status without parameters' },
    });
    await expect(repo.getStatus()).rejects.toMatchObject({ name: 'DemoDataError', code: 'not_installed' });
  });

  // A 200 answer that proves nothing (an empty or partial body, e.g. from an older installed seed)
  // is not "nothing copied": the card must not claim an empty copy from it.
  it.each([
    ['no body', null],
    ['an empty object', {}],
    ['a count that is not a number', { members: 'x', posts: 1, organizations: 0, follows: 0, saved_posts: 0, last_copied_at: null }],
    ['no last-copy field', { members: 1, posts: 1, organizations: 0, follows: 0, saved_posts: 0 }],
    ['a last copy that is not a time', { members: 1, posts: 1, organizations: 0, follows: 0, saved_posts: 0, last_copied_at: 5 }],
  ])('a status answer with %s is refused as outdated, never read as an empty copy', async (_label, data) => {
    const { repo } = repoWith({ data, error: null });
    await expect(repo.getStatus()).rejects.toMatchObject({ name: 'DemoDataError', code: 'outdated' });
  });

  it('a delete answer without its counts is refused as outdated, never reported as "deleted 0"', async () => {
    const { repo } = repoWith({ data: { members: 2 }, error: null });
    await expect(repo.deleteAll()).rejects.toMatchObject({ name: 'DemoDataError', code: 'outdated' });
  });

  it('a member without the role is refused as forbidden', async () => {
    const { repo } = repoWith({ data: null, error: { code: '42501', message: 'forbidden' } });
    await expect(repo.deleteAll()).rejects.toMatchObject({ code: 'forbidden' });
  });
});
