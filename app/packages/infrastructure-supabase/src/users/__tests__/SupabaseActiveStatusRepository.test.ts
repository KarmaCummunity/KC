import { describe, it, expect } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient, type FakeResult } from '../../__tests__/fakeBaselineClient';
import { SupabaseActiveStatusRepository } from '../SupabaseActiveStatusRepository';

const ok = (data: unknown = null): FakeResult => ({ data, error: null });

describe('SupabaseActiveStatusRepository', () => {
  it('get reads show_active_status of the caller\'s own user_private row', async () => {
    const { client, calls } = createFakeClient({ tables: { user_private: ok({ show_active_status: false }) }, userId: 'u1' });

    expect(await new SupabaseActiveStatusRepository(client).get()).toBe(false);

    expect(calls[0]).toMatchObject({ table: 'user_private', columns: 'show_active_status' });
    expect(calls[0]?.filters).toContainEqual(['eq', 'user_id', 'u1']);
  });

  it.each([[null], [{ show_active_status: true }]])('get defaults to true when the row says %j', async (row) => {
    const { client } = createFakeClient({ tables: { user_private: ok(row) }, userId: 'u1' });

    expect(await new SupabaseActiveStatusRepository(client).get()).toBe(true);
  });

  it('get is true without a call when nobody is signed in', async () => {
    const { client, calls } = createFakeClient({ userId: null });

    expect(await new SupabaseActiveStatusRepository(client).get()).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('set writes the flag to user_private and returns it', async () => {
    const { client, calls } = createFakeClient({ userId: 'u1' });

    expect(await new SupabaseActiveStatusRepository(client).set(false)).toBe(false);

    expect(calls[0]).toMatchObject({ kind: 'update', table: 'user_private', payload: { show_active_status: false } });
    expect(calls[0]?.filters).toContainEqual(['eq', 'user_id', 'u1']);
  });

  it('set refuses when nobody is signed in', async () => {
    const { client } = createFakeClient({ userId: null });

    await expect(new SupabaseActiveStatusRepository(client).set(true)).rejects.toThrow('not signed in');
  });

  it('surfaces a failed read', async () => {
    const { client } = createFakeClient({
      tables: { user_private: { data: null, error: { message: 'boom' } } },
      userId: 'u1',
    });

    await expect(new SupabaseActiveStatusRepository(client).get()).rejects.toThrow('boom');
  });

  it('reports a missing table as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      tables: { user_private: { data: null, error: { code: 'PGRST205', message: 'not found' } } },
      userId: 'u1',
    });

    await expect(new SupabaseActiveStatusRepository(client).get()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
