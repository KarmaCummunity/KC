import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityDatabase } from '../platform/database/identityDatabase';
import type { CallerIdentity } from '../platform/identity/callerIdentity';
import { USER_A, USER_B } from './support/testTokens';

const { DATABASE_URL, KC_API_TEST_DISPOSABLE_DATABASE } = process.env;

const SCHEMA = 'kc_api_identity_test';
const callerOf = (userId: string): CallerIdentity => ({ userId, claims: { sub: userId, role: 'authenticated' } });

/**
 * The identity bridge against a real Postgres. It creates roles and a schema,
 * so it runs only on a database explicitly marked disposable (a local
 * instance or a CI service container), never on a shared one.
 */
describe.skipIf(!DATABASE_URL || KC_API_TEST_DISPOSABLE_DATABASE !== '1')('IdentityDatabase on Postgres', () => {
  let pool: Pool;
  let database: IdentityDatabase;

  const notesSeenBy = (session: { query: Pool['query'] }) =>
    session.query<{ body: string }>(`select body from ${SCHEMA}.notes order by body`).then((r) => r.rows.map((row) => row.body));

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    database = new IdentityDatabase(pool);
    // What a Supabase database already has: the two request roles and auth.uid().
    await pool.query(`
      do $$ begin
        if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      end $$;
      create schema if not exists auth;
      grant usage on schema auth to authenticated, anon;
      do $$ begin
        if to_regprocedure('auth.uid()') is null then
          create function auth.uid() returns uuid language sql stable as
            'select (nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''sub'')::uuid';
        end if;
      end $$;
      drop schema if exists ${SCHEMA} cascade;
      create schema ${SCHEMA};
      grant usage on schema ${SCHEMA} to authenticated, anon;
      create table ${SCHEMA}.notes (owner uuid not null, body text not null);
      alter table ${SCHEMA}.notes enable row level security;
      create policy notes_owner on ${SCHEMA}.notes for all to authenticated
        using (owner = auth.uid()) with check (owner = auth.uid());
      grant select, insert on ${SCHEMA}.notes to authenticated;
      grant select on ${SCHEMA}.notes to anon;
      insert into ${SCHEMA}.notes (owner, body) values
        ('${USER_A}', 'a-1'), ('${USER_A}', 'a-2'), ('${USER_B}', 'b-1');
    `);
  });

  afterAll(async () => {
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  });

  it('resolves auth.uid() to the caller', async () => {
    const resolved = await database.runAs(callerOf(USER_A), (session) =>
      session.query<{ uid: string }>('select auth.uid() as uid').then((r) => r.rows[0]?.uid),
    );

    expect(resolved).toBe(USER_A);
  });

  it('hands the claims to the database unchanged, whatever characters they hold', async () => {
    const email = `o'neil\\"quoted" $1 \n; drop table x; -- é`;
    const caller = { userId: USER_A, claims: { sub: USER_A, role: 'authenticated', email } };

    const seen = await database.runAs(caller, (session) =>
      session
        .query<{ email: string }>("select current_setting('request.jwt.claims')::jsonb ->> 'email' as email")
        .then((r) => r.rows[0]?.email),
    );

    expect(seen).toBe(email);
  });

  it('shows each caller only their own rows', async () => {
    expect(await database.runAs(callerOf(USER_A), notesSeenBy)).toEqual(['a-1', 'a-2']);
    expect(await database.runAs(callerOf(USER_B), notesSeenBy)).toEqual(['b-1']);
  });

  it('shows a signed-out visitor nothing', async () => {
    expect(await database.runAnonymous(notesSeenBy)).toEqual([]);
  });

  it('refuses a write on behalf of someone else', async () => {
    const write = database.runAs(callerOf(USER_A), (session) =>
      session.query(`insert into ${SCHEMA}.notes (owner, body) values ($1, 'forged')`, [USER_B]),
    );

    await expect(write).rejects.toThrow(/row-level security/);
  });

  it('rolls back everything when the work fails', async () => {
    const work = database.runAs(callerOf(USER_A), async (session) => {
      await session.query(`insert into ${SCHEMA}.notes (owner, body) values ($1, 'a-rolled-back')`, [USER_A]);
      throw new Error('handler failed after writing');
    });

    await expect(work).rejects.toThrow('handler failed after writing');
    expect(await database.runAs(callerOf(USER_A), notesSeenBy)).toEqual(['a-1', 'a-2']);
  });

  it('leaves no identity on the pooled connection', async () => {
    await database.runAs(callerOf(USER_A), notesSeenBy);

    // max: 2 and sequential use, so this query reuses the connection above.
    const after = await pool.query<{ claims: string; role: string }>(
      "select coalesce(current_setting('request.jwt.claims', true), '') as claims, current_user as role",
    );

    expect(after.rows[0]?.claims).toBe('');
    expect(after.rows[0]?.role).not.toBe('authenticated');
  });

  it('returns its connections to the pool after successes and failures', () => {
    expect(pool.totalCount).toBeLessThanOrEqual(2);
    expect(pool.idleCount).toBe(pool.totalCount);
  });
});
