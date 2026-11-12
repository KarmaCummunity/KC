import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseBlockRepository } from '../SupabaseBlockRepository';

describe('SupabaseBlockRepository', () => {
  it('isBlocking reflects whether a row exists', async () => {
    const yes = createFakeClient({ tables: { blocks: { data: { blocked_id: 'b' }, error: null } } });
    const no = createFakeClient({ tables: { blocks: { data: null, error: null } } });

    expect(await new SupabaseBlockRepository(yes.client).isBlocking('a', 'b')).toBe(true);
    expect(await new SupabaseBlockRepository(no.client).isBlocking('a', 'b')).toBe(false);
    expect(yes.calls[0]?.filters).toEqual([['eq', 'blocker_id', 'a'], ['eq', 'blocked_id', 'b']]);
  });

  it('block inserts the pair', async () => {
    const { client, calls } = createFakeClient();

    await new SupabaseBlockRepository(client).block('a', 'b');

    expect(calls[0]).toMatchObject({ kind: 'insert', table: 'blocks', payload: { blocker_id: 'a', blocked_id: 'b' } });
  });

  it('block treats a duplicate as success and surfaces other failures', async () => {
    const dup = createFakeClient({ tables: { blocks: { data: null, error: { code: '23505', message: 'dup' } } } });
    const denied = createFakeClient({ tables: { blocks: { data: null, error: { code: '42501', message: 'rls' } } } });

    await expect(new SupabaseBlockRepository(dup.client).block('a', 'b')).resolves.toBeUndefined();
    await expect(new SupabaseBlockRepository(denied.client).block('a', 'b')).rejects.toThrow('rls');
  });

  it('block reports a missing table as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      tables: { blocks: { data: null, error: { code: 'PGRST205', message: 'not found' } } },
    });

    await expect(new SupabaseBlockRepository(client).block('a', 'b')).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('unblock deletes the blocker row', async () => {
    const { client, calls } = createFakeClient();

    await new SupabaseBlockRepository(client).unblock('a', 'b');

    expect(calls[0]).toMatchObject({ kind: 'delete', table: 'blocks' });
    expect(calls[0]?.filters).toEqual([['eq', 'blocker_id', 'a'], ['eq', 'blocked_id', 'b']]);
  });

  it('listMyBlockedUsers maps the rows of list_my_blocked_users (FR-MOD-004 AC1)', async () => {
    const { client, calls } = createFakeClient({
      rpc: {
        list_my_blocked_users: {
          data: [{ user_id: 'b', display_name: 'Bee', avatar_url: null, blocked_at: '2026-11-03T10:00:00Z' }],
          error: null,
        },
      },
    });

    await expect(new SupabaseBlockRepository(client).listMyBlockedUsers()).resolves.toEqual([
      { userId: 'b', displayName: 'Bee', avatarUrl: null, blockedAt: '2026-11-03T10:00:00Z' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ fn: 'list_my_blocked_users', args: { p_limit: 100 } });
  });

  it('listMyBlockedUsers reads the next keyset page while a page comes back full', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      user_id: `u${i}`, display_name: null, avatar_url: null, blocked_at: `2026-11-03T10:00:${String(59 - (i % 60)).padStart(2, '0')}Z`,
    }));
    const { client, calls } = createFakeClient({ rpc: { list_my_blocked_users: { data: full, error: null } } });

    const users = await new SupabaseBlockRepository(client).listMyBlockedUsers();

    // The fake answers every page with the same full page, so the loop stops at its bound.
    expect(calls).toHaveLength(20);
    expect(users).toHaveLength(2000);
    expect(calls[1]?.args).toMatchObject({ p_before_user_id: 'u99', p_before_blocked_at: full[99]!.blocked_at });
  });

  it('listMyBlockedUsers reports a missing function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { list_my_blocked_users: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } } },
    });

    await expect(new SupabaseBlockRepository(client).listMyBlockedUsers()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
