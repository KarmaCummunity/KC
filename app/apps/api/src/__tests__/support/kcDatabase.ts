import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { IdentityDatabase } from '../../platform/database/identityDatabase';
import type { CallerIdentity } from '../../platform/identity/callerIdentity';
import type { ResultRow } from '../../platform/postgrest/sqlStatements';
import { createSchemaCacheSource } from '../../platform/postgrest/schemaCacheSource';
import { createSqlBackedClient } from '../../platform/postgrest/sqlBackedClient';

/**
 * Connection string of a throwaway database that holds the KC schema, built by
 * `scripts/run-baseline-tests.sh` on a local Postgres. Suites that need the
 * real schema run only when it is set.
 */
export const KC_DATABASE_URL = process.env.KC_API_TEST_KC_DATABASE_URL;
/**
 * The connection the server under test uses, when it should not be the fixtures' own: the
 * API's database user (`kc_api`), which holds no rights until it switches role. Unset, the
 * server connects as the fixtures do.
 */
export const API_DATABASE_URL = process.env.KC_API_TEST_API_DATABASE_URL;

export interface TestMember {
  readonly userId: string;
  readonly displayName: string;
  readonly caller: CallerIdentity;
}

/**
 * The KC schema for tests: creates members the way sign-up does (a row in
 * `auth.users`, from which the schema's own trigger builds the profile and an
 * active account) and hands out Supabase-shaped clients acting as them.
 */
export class KcTestDatabase {
  /** Superuser connection: seeding and assertions the members themselves may not make. */
  readonly admin = new Pool({ connectionString: KC_DATABASE_URL, max: 4 });
  private readonly database = new IdentityDatabase(this.admin);
  private readonly schema = createSchemaCacheSource(<Row>(text: string) => this.admin.query(text) as unknown as Promise<{ rows: Row[] }>);
  private readonly created: string[] = [];

  async newMember(): Promise<TestMember> {
    const userId = randomUUID();
    const tag = userId.slice(0, 8);
    const displayName = `contract ${tag}`;
    await this.admin.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())', [
      userId,
      `contract-${tag}@kc.test`,
    ]);
    this.created.push(userId);
    await this.admin.query('update public.users set display_name = $2 where id = $1', [userId, displayName]);
    return { userId, displayName, caller: { userId, claims: { sub: userId, role: 'authenticated' } } };
  }

  /**
   * A client acting as `caller`; every request is its own transaction, as with PostgREST.
   * `Client` is the adapter's own client type (inferred from its constructor).
   * @param observe Sees every request the adapter makes with the engine's answer.
   */
  clientFor<Client>(caller: CallerIdentity | null, observe?: Parameters<typeof createSqlBackedClient>[3]): Client {
    const run = (statement: { text: string; values: readonly unknown[] }) => {
      const work = (session: { query: Pool['query'] }) =>
        session.query<ResultRow>(statement.text, [...statement.values]).then((result) => result.rows[0]);
      return caller ? this.database.runAs(caller, work) : this.database.runAnonymous(work);
    };
    return createSqlBackedClient(caller, this.schema, run, observe) as unknown as Client;
  }

  /** Removes the members this instance created (their rows cascade) and closes the pool. */
  async close(): Promise<void> {
    await this.admin.query('delete from auth.users where id = any($1)', [this.created]).catch(() => undefined);
    await this.admin.end();
  }
}
