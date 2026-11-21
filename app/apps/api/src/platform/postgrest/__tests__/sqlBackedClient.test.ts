import { describe, expect, it } from 'vitest';
import type { StatementRunner } from '../engine';
import { createSqlBackedClient, UnsupportedSupabaseServiceError } from '../sqlBackedClient';
import type { SqlStatement } from '../sqlText';
import { cacheSource } from './support';

const caller = { userId: '11111111-1111-4111-8111-111111111111', claims: {} };

function setup(body: string | null, rowCount: number) {
  const statements: SqlStatement[] = [];
  const run: StatementRunner = (statement) => {
    statements.push(statement);
    return Promise.resolve({ body, row_count: rowCount });
  };
  return { client: createSqlBackedClient(caller, cacheSource(), run), statements };
}

describe('createSqlBackedClient', () => {
  it('answers a builder query in process, with the data the adapters expect', async () => {
    const { client, statements } = setup('[{"id":1,"title":"a"}]', 1);

    const { data, error } = await client.from('books').select('id, title').eq('author_id', '7').order('id').limit(5);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 1, title: 'a' }]);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.values).toEqual(['7']);
    expect(statements[0]?.text).toContain('limit 5');
  });

  it('gives maybeSingle its object, or null for no row', async () => {
    expect((await setup('[{"id":1}]', 1).client.from('books').select('id').maybeSingle()).data).toEqual({ id: 1 });
    expect((await setup('[]', 0).client.from('books').select('id').maybeSingle()).data).toBeNull();
  });

  it('returns a function result and sends its arguments as JSON', async () => {
    const { client, statements } = setup('3', 1);

    const { data } = await client.rpc('book_count', { p_author: '7' });

    expect(data).toBe(3);
    expect(statements[0]?.values).toEqual(['{"p_author":"7"}']);
  });

  it('surfaces a refusal as the error object adapters map on', async () => {
    const { error } = await setup(null, 0).client.rpc('nope');

    expect(error).toMatchObject({ code: 'PGRST202' });
  });

  it('answers the session lookups from the caller', async () => {
    const signedIn = createSqlBackedClient(caller, cacheSource(), () => Promise.resolve(undefined));
    const signedOut = createSqlBackedClient(null, cacheSource(), () => Promise.resolve(undefined));

    expect((await signedIn.auth.getSession()).data.session?.user.id).toBe(caller.userId);
    expect((await signedIn.auth.getUser()).data.user?.id).toBe(caller.userId);
    expect((await signedOut.auth.getSession()).data.session).toBeNull();
    expect((await signedOut.auth.getUser()).data.user).toBeNull();
  });

  it('names a Supabase service it does not carry instead of failing obscurely', () => {
    const client = setup(null, 0).client as unknown as { functions: unknown; storage: unknown; channel(name: string): unknown };

    expect(() => client.functions).toThrow(UnsupportedSupabaseServiceError);
    expect(() => client.storage).toThrow(UnsupportedSupabaseServiceError);
    expect(() => client.channel('x')).toThrow(UnsupportedSupabaseServiceError);
  });
});
