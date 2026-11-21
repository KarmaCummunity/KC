import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';
import { KC_DATABASE_URL, KcTestDatabase, type TestMember } from '../support/kcDatabase';

/**
 * The compatibility engine against the real KC schema, for the parts of the
 * PostgREST dialect the port contracts do not reach: counts, single-object
 * reads, logic trees, embedded resources, and what row-level security makes
 * of direct writes.
 */
describe.skipIf(!KC_DATABASE_URL)('Compatibility engine on the KC schema', () => {
  const database = new KcTestDatabase();
  let alice: TestMember;
  let bob: TestMember;
  let asAlice: SqlBackedClient;
  let asVisitor: SqlBackedClient;

  beforeAll(async () => {
    alice = await database.newMember();
    bob = await database.newMember();
    asAlice = database.clientFor(alice.caller);
    asVisitor = database.clientFor(null);
  });

  afterAll(async () => {
    await database.close();
  });

  it('pages, orders and counts a reference table', async () => {
    const page = await asAlice.from('cities').select('city_id, name_he', { count: 'exact' }).order('city_id').range(2, 4);
    const all = await asAlice.from('cities').select('city_id', { count: 'exact', head: true });

    expect(page.error).toBeNull();
    expect(page.data).toHaveLength(3);
    expect(page.count).toBeGreaterThan(100);
    expect(all.count).toBe(page.count);
    expect(all.data).toBeNull();
  });

  it('filters with in, ilike and a logic tree, as PostgREST would', async () => {
    const byList = await asAlice.from('cities').select('city_id').in('city_id', ['5000', '3000']).order('city_id');
    const byTree = await asAlice
      .from('cities')
      .select('city_id')
      .or('city_id.eq.5000,and(city_id.eq.3000,name_he.ilike."%ירושלים%")')
      .order('city_id');

    expect(byList.data).toEqual([{ city_id: '3000' }, { city_id: '5000' }]);
    expect(byTree.data).toEqual(byList.data);
  });

  it('answers single() with an object and reports zero rows the way the client expects', async () => {
    const one = await asAlice.from('cities').select('city_id').eq('city_id', '5000').single();
    const none = await asAlice.from('cities').select('city_id').eq('city_id', 'no-such-city').single();
    const maybe = await asAlice.from('cities').select('city_id').eq('city_id', 'no-such-city').maybeSingle();

    expect(one.data).toEqual({ city_id: '5000' });
    expect(none.error).toMatchObject({ code: 'PGRST116' });
    expect(maybe).toMatchObject({ data: null, error: null });
  });

  it('embeds a one-to-one relation as an object', async () => {
    const { data, error } = await asAlice.from('users').select('id, user_stats(user_id)').eq('id', alice.userId).single();

    expect(error).toBeNull();
    expect(data).toEqual({ id: alice.userId, user_stats: { user_id: alice.userId } });
  });

  it('lets a member change their own row and returns it', async () => {
    const { data, error } = await asAlice.from('users').update({ biography: 'hello' }).eq('id', alice.userId).select('id, biography');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: alice.userId, biography: 'hello' }]);
  });

  it("leaves another member's row untouched: row-level security filters it out", async () => {
    const { data, error } = await asAlice.from('users').update({ biography: 'defaced' }).eq('id', bob.userId).select('id');
    const after = await database.admin.query<{ biography: string | null }>('select biography from public.users where id = $1', [bob.userId]);

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(after.rows[0]?.biography).not.toBe('defaced');
  });

  it('refuses a whole-table update or delete', async () => {
    const update = await asAlice.from('users').update({ biography: 'x' });
    const remove = await asAlice.from('follows').delete();

    expect(update.error).toMatchObject({ code: '21000' });
    expect(remove.error).toMatchObject({ code: '21000' });
  });

  it('reports an unknown table, function or column with the codes the adapters degrade on', async () => {
    expect((await asAlice.from('no_such_table').select('*')).error).toMatchObject({ code: 'PGRST205' });
    expect((await asAlice.rpc('no_such_function')).error).toMatchObject({ code: 'PGRST202' });
    expect((await asAlice.from('cities').select('no_such_column')).error).toMatchObject({ code: '42703' });
  });

  it('gives a signed-out visitor only what the anon role may read', async () => {
    const own = await asVisitor.from('user_private').select('user_id').limit(1);

    // Either the grant is missing (permission denied) or RLS returns nothing; never a row.
    expect(own.data ?? []).toEqual([]);
  });
});
