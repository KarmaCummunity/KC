import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import type { ApiConfig } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import type { DependencyProbe } from '../health/dependencyProbe';
import { APP_LOGGER, type AppLogger, appLoggerProvider } from '../logging/appLogger';
import { DATABASE_POOL } from './database.tokens';
import { IdentityDatabase } from './identityDatabase';

/**
 * Upper bound of connections one API instance opens. The database's own
 * limit is shared by every instance, so this stays small and the instance
 * count does the scaling.
 */
const MAX_POOL_CONNECTIONS = 10;

/** Builds the pool. No connection is opened until the first query. */
function createPool(config: ApiConfig, logger: AppLogger): Pool {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: MAX_POOL_CONNECTIONS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // An idle connection the server drops emits `error` on the pool; without a
  // listener Node treats it as an uncaught exception and the process exits.
  pool.on('error', (error) => logger.error({ err: error }, 'idle database connection failed'));
  return pool;
}

/** Readiness probe: one round trip to Postgres through the pool. */
@Injectable()
export class DatabaseProbe implements DependencyProbe {
  readonly name = 'database';

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }
}

/** Closes the pool when the process stops, so the server frees the connections at once. */
@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    appLoggerProvider,
    { provide: DATABASE_POOL, inject: [API_CONFIG, APP_LOGGER], useFactory: createPool },
    DatabaseProbe,
    DatabaseShutdown,
    IdentityDatabase,
  ],
  exports: [DATABASE_POOL, DatabaseProbe, IdentityDatabase],
})
export class DatabaseModule {}
