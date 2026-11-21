import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.tokens';
import { type DatabaseSession, IdentityDatabase } from '../database/identityDatabase';
import type { CallerIdentity } from '../identity/callerIdentity';
import type { SchemaCacheSource, StatementRunner } from '../postgrest/engine';
import type { CatalogQuery } from '../postgrest/schemaCache';
import { createSchemaCacheSource } from '../postgrest/schemaCacheSource';
import { createSqlBackedClient, type SqlBackedClient } from '../postgrest/sqlBackedClient';
import type { ResultRow } from '../postgrest/sqlStatements';

/**
 * Hands out the database client a hosted adapter uses for one call. Every
 * request the adapter makes runs in its own transaction as the caller (or as
 * a signed-out visitor), which is what one PostgREST request is today.
 */
@Injectable()
export class PortClients {
  /** One schema cache for the process; it is the same for every caller. */
  private readonly schema: SchemaCacheSource;

  constructor(
    @Inject(DATABASE_POOL) pool: Pool,
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
  ) {
    const catalog: CatalogQuery = (text) => pool.query(text) as never;
    this.schema = createSchemaCacheSource(catalog);
  }

  clientFor(caller: CallerIdentity | null): SqlBackedClient {
    const run: StatementRunner = (statement) => {
      const work = (session: DatabaseSession) =>
        session.query<ResultRow>(statement.text, [...statement.values]).then((result) => result.rows[0]);
      return caller ? this.database.runAs(caller, work) : this.database.runAnonymous(work);
    };
    return createSqlBackedClient(caller, this.schema, run);
  }
}
