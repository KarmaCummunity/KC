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

  it('listMyBlockedUsers reports the capability as missing (M01) without calling the database', async () => {
    const { client, calls } = createFakeClient();

    const error = await new SupabaseBlockRepository(client).listMyBlockedUsers().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect(error).toMatchObject({ object: 'rpc:list_my_blocked_users' });
    expect(calls).toHaveLength(0);
  });
});
