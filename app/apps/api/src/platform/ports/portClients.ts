import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.tokens';
import { type DatabaseSession, IdentityDatabase } from '../database/identityDatabase';
import type { CallerIdentity } from '../identity/callerIdentity';
import { APP_LOGGER, type AppLogger } from '../logging/appLogger';
import type { CompatResponse, SchemaCacheSource, StatementRunner } from '../postgrest/engine';
import type { CompatRequest } from '../postgrest/requestPlan';
import type { CatalogQuery } from '../postgrest/schemaCache';
import { createSchemaCacheSource } from '../postgrest/schemaCacheSource';
import { createSqlBackedClient, type InProcessFunctions, type SqlBackedClient } from '../postgrest/sqlBackedClient';
import type { ResultRow } from '../postgrest/sqlStatements';
import { CALLER_FILES, type CallerFiles } from './callerFiles';

/**
 * Error codes that mean the engine itself could not serve a request an
 * adapter built: a part of the PostgREST dialect it does not implement
 * (`PGRST100`) or SQL it generated wrongly (`42601`, a syntax error). Unlike a
 * refusal by the database, these are faults of this server and must be seen.
 */
const ENGINE_FAULT_CODES = new Set(['PGRST100', '42601']);

/** The error code of an engine answer, or null for a success. */
export function errorCodeOf(response: CompatResponse): string | null {
  if (response.status < 400 || response.body === null) return null;
  try {
    return (JSON.parse(response.body) as { code?: string }).code ?? null;
  } catch {
    return null;
  }
}

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
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    // Absent on a server composed without the storage module (some test compositions).
    @Optional() @Inject(CALLER_FILES) private readonly files: CallerFiles | null = null,
  ) {
    const catalog: CatalogQuery = (text) => pool.query(text) as never;
    this.schema = createSchemaCacheSource(catalog);
  }

  /** @param functions The Edge Functions this server answers for this caller (see `HostedFunctions`). */
  clientFor(caller: CallerIdentity | null, functions?: InProcessFunctions): SqlBackedClient {
    const run: StatementRunner = (statement) => {
      const work = this.statementWork(statement);
      return caller ? this.database.runAs(caller, work) : this.database.runAnonymous(work);
    };
    return createSqlBackedClient(caller, this.schema, run, (request, response) => this.reportEngineFault(request, response), functions, this.files?.forCaller(caller) ?? null);
  }

  /** True when a client's `storage` is answered here: the methods that need files can be served. */
  get hasFileStore(): boolean {
    return this.files?.available ?? false;
  }

  /**
   * A client that acts as the service role, for server modules only (see
   * `IdentityDatabase.runAsService`). It is never handed to a hosted adapter.
   */
  serviceClient(): SqlBackedClient {
    const run: StatementRunner = (statement) => this.database.runAsService(this.statementWork(statement));
    return createSqlBackedClient(null, this.schema, run, (request, response) => this.reportEngineFault(request, response));
  }

  private statementWork(statement: Parameters<StatementRunner>[0]) {
    return (session: DatabaseSession) => session.query<ResultRow>(statement.text, [...statement.values]).then((result) => result.rows[0]);
  }

  /** Logs an engine fault with the request's path (table or function) only: query values can be personal data. */
  private reportEngineFault(request: CompatRequest, response: CompatResponse): void {
    const code = errorCodeOf(response);
    if (!code || !ENGINE_FAULT_CODES.has(code)) return;
    const { message } = JSON.parse(response.body ?? '{}') as { message?: string };
    this.logger.error({ code, method: request.method, path: new URL(request.url).pathname, reason: message }, 'compatibility engine could not serve a request');
  }
}
