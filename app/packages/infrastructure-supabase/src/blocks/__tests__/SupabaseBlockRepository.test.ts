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

  it('listMyBlockedUsers maps the rows of list_my_blocked_users', async () => {
    const rows = [
      { user_id: 'u1', display_name: 'Dana', avatar_url: null, blocked_at: '2026-01-02T00:00:00Z' },
      { user_id: 'u2', display_name: null, avatar_url: 'https://img/x.png', blocked_at: '2026-01-01T00:00:00Z' },
    ];
    const { client, calls } = createFakeClient({ rpc: { list_my_blocked_users: { data: rows, error: null } } });

    const users = await new SupabaseBlockRepository(client).listMyBlockedUsers();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'list_my_blocked_users' });
    expect(users).toEqual([
      { userId: 'u1', displayName: 'Dana', avatarUrl: null, blockedAt: '2026-01-02T00:00:00Z' },
      { userId: 'u2', displayName: null, avatarUrl: 'https://img/x.png', blockedAt: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('listMyBlockedUsers is empty with no blocks and degrades when the function is missing', async () => {
    const none = createFakeClient({ rpc: { list_my_blocked_users: { data: null, error: null } } });
    const missing = createFakeClient({
      rpc: { list_my_blocked_users: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });

    await expect(new SupabaseBlockRepository(none.client).listMyBlockedUsers()).resolves.toEqual([]);
    await expect(new SupabaseBlockRepository(missing.client).listMyBlockedUsers()).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});
