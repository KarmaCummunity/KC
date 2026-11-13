// FR-ADMIN-031 — the Demo data adapter: RPC names and arguments, mapping of the jsonb answers,
// and refusals mapped by their stable message (a database without the tools is `not_installed`).
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DemoDataError } from '@kc/domain';
import type { Database } from '../../database.types';
import { SupabaseDemoDataRepository } from '../SupabaseDemoDataRepository';

type Rpc = (name: string, args?: unknown) => unknown;

function repoWith(rpc: Rpc) {
  const spy = vi.fn(async (name: string, args?: unknown) => rpc(name, args));
  const client = { rpc: spy } as unknown as SupabaseClient<Database>;
  return { repo: new SupabaseDemoDataRepository(client), rpc: spy };
}
const ok = (data: unknown) => () => ({ data, error: null });
const refuse = (message: string, code = 'P0001') => () => ({ data: null, error: { code, message } });

const STATUS = {
  demo_users: 200, demo_organizations: 3, demo_item_posts: 600, demo_ride_posts: 120, demo_follows: 1600,
  demo_chats: 150, demo_org_memberships: 12, can_seed: true, has_saved_password: false,
  operation: 'idle', phase: 'idle',
};

describe('SupabaseDemoDataRepository', () => {
  it('reads and maps the status', async () => {
    const { repo, rpc } = repoWith(ok(STATUS));
    await expect(repo.getStatus()).resolves.toEqual({
      demoUsers: 200, demoOrganizations: 3, demoItemPosts: 600, demoRidePosts: 120, demoFollows: 1600,
      demoChats: 150, demoOrgMemberships: 12, canSeed: true, hasSavedPassword: false,
    });
    expect(rpc).toHaveBeenCalledWith('admin_demo_data_status');
  });

  it('a missing count reads as zero, never NaN', async () => {
    const { repo } = repoWith(ok({ demo_users: 2 }));
    const status = await repo.getStatus();
    expect(status.demoUsers).toBe(2);
    expect(status.demoChats).toBe(0);
    expect(status.canSeed).toBe(false);
  });

  it('maps an unfinished wipe step and the final one', async () => {
    const { repo, rpc } = repoWith(ok({ done: false, progress_key: 'wipe_accounts' }));
    await expect(repo.wipeStep()).resolves.toEqual({ done: false, progressKey: 'wipe_accounts', result: null });
    expect(rpc).toHaveBeenCalledWith('admin_wipe_demo_data_step');

    const last = repoWith(ok({
      done: true, progress_key: 'done',
      result: { users_deleted: 200, posts_deleted: 720, chats_deleted: 150, organizations_deleted: 2, organizations_kept: 1 },
    }));
    await expect(last.repo.wipeStep()).resolves.toEqual({
      done: true, progressKey: 'done',
      result: { usersDeleted: 200, postsDeleted: 720, chatsDeleted: 150, organizationsDeleted: 2, organizationsKept: 1 },
    });
  });

  it('sends the password only when given, and maps the restore result', async () => {
    const { repo, rpc } = repoWith(ok({ done: true, progress_key: 'done', result: STATUS }));
    const step = await repo.seedStep('SeedPass-2026');
    expect(rpc).toHaveBeenCalledWith('admin_seed_demo_data_step', { p_password: 'SeedPass-2026' });
    expect(step.result).toEqual({
      users: 200, itemPosts: 600, ridePosts: 120, follows: 1600, chats: 150, organizations: 3, orgMemberships: 12,
    });
    await repo.seedStep();
    expect(rpc).toHaveBeenLastCalledWith('admin_seed_demo_data_step', {});
  });

  it.each([
    ['not_dev_environment', '42501', 'not_dev_environment'],
    ['cannot_wipe_self', '42501', 'cannot_wipe_self'],
    ['forbidden', '42501', 'forbidden'],
    ['password_required', 'P0001', 'password_required'],
    ['password_too_short', 'P0001', 'password_too_short'],
    ['demo_operation_busy', 'P0001', 'demo_operation_busy'],
    ['canceling statement due to statement timeout', '57014', 'timeout'],
    ['boom', 'XX000', 'unknown'],
  ])('maps the refusal %s (%s) to %s', async (message, code, expected) => {
    const { repo } = repoWith(refuse(message, code));
    const error = await repo.seedStep().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoDataError);
    expect((error as DemoDataError).code).toBe(expected);
  });

  it('a database without the demo-data tools answers not_installed (kc-prod)', async () => {
    const { repo } = repoWith(refuse('Could not find the function public.admin_demo_data_status without parameters in the schema cache', 'PGRST202'));
    await expect(repo.getStatus()).rejects.toMatchObject({ code: 'not_installed' });
  });
});
