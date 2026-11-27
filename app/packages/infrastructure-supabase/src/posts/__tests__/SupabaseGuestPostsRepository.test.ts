import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseGuestPostsRepository } from '../SupabaseGuestPostsRepository';
const id = '40000000-0000-4000-8000-000000000001';
const row = {
  id, title: 'Desk', description: 'A small desk', city_name_he: 'city', city_name_en: 'City',
  author_share_handle: 'alice', owner_id: 'never-copy', details: { phone: 'never-copy' },
};
describe('guest posts adapter', () => {
  it('calls only the narrow guest RPC and projects out any unexpected member fields', async () => {
    const { client, calls } = createFakeClient({ rpc: { guest_posts: { data: [row], error: null } } });
    const repo = new SupabaseGuestPostsRepository(client);
    expect(await repo.list()).toEqual([{
      id, title: 'Desk', description: 'A small desk', cityNameHe: 'city', cityNameEn: 'City',
      authorShareHandle: 'alice',
    }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'guest_posts', args: { p_limit: 20 } });
    await repo.list(id);
    expect(calls[1]?.args).toEqual({ p_limit: 20, p_before_id: id });
    expect(await repo.get(id)).toMatchObject({ id, authorShareHandle: 'alice' });
    expect(calls[2]?.args).toEqual({ p_post_id: id, p_limit: 1 });
  });
  it('maps a null author handle to null without inventing a profile link', async () => {
    const { client } = createFakeClient({
      rpc: { guest_posts: { data: [{ ...row, author_share_handle: null }], error: null } },
    });
    expect((await new SupabaseGuestPostsRepository(client).list())[0]?.authorShareHandle).toBeNull();
  });
  it('invalid identifiers never issue a query', async () => {
    const { client, calls } = createFakeClient();
    const repo = new SupabaseGuestPostsRepository(client);
    expect(await repo.get('not-an-id')).toBeNull();
    expect(await repo.list('invalid')).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it('treats absent or private detail identically', async () => {
    const { client } = createFakeClient();
    const repo = new SupabaseGuestPostsRepository(client);
    expect(await repo.get(id)).toBeNull();
    expect(await repo.list()).toEqual([]);
  });
  it('surfaces backend failure rather than claiming an empty feed', async () => {
    const { client } = createFakeClient({ rpc: { guest_posts: { data: null, error: { code: '42501', message: 'permission denied for function guest_posts' } } } });
    await expect(new SupabaseGuestPostsRepository(client).list()).rejects.toThrow();
  });
});
