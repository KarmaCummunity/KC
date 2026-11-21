import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { CallerIdentity } from '../identity/callerIdentity';
import { DATABASE_POOL } from './database.tokens';

/** What request code may do with its transaction: run queries, nothing else. */
export type DatabaseSession = Pick<PoolClient, 'query'>;

/**
 * Sets the caller for the current transaction. `true` scopes each setting to
 * the transaction: when it ends, the pooled connection carries no trace of the
 * caller for its next user. The search path is the one PostgREST uses on the
 * Supabase stack (`supabase/config.toml`, `extra_search_path`).
 */
export const IDENTITY_SQL =
  "select set_config('role', $1, true), set_config('request.jwt.claims', $2, true), set_config('search_path', 'public, extensions', true)";

/** Database roles a request can run as. Never taken from client input. */
type RequestRole = 'authenticated' | 'anon';

/**
 * Runs database work as the caller, the way PostgREST does: one transaction
 * whose role and JWT claims are the caller's. Inside it `auth.uid()`, every
 * RLS policy and every existing SQL function see the same caller they see
 * today, so a port can move behind the API with no SQL change.
 */
@Injectable()
export class IdentityDatabase {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** Runs `work` as the signed-in caller. Commits on success, rolls back on any error. */
  runAs<T>(identity: CallerIdentity, work: (session: DatabaseSession) => Promise<T>): Promise<T> {
    return this.runWithRole('authenticated', identity.claims, work);
  }

  /** Runs `work` as a signed-out visitor: only what the `anon` role may see. */
  runAnonymous<T>(work: (session: DatabaseSession) => Promise<T>): Promise<T> {
    return this.runWithRole('anon', { role: 'anon' }, work);
  }

  private async runWithRole<T>(
    role: RequestRole,
    claims: Readonly<Record<string, unknown>>,
    work: (session: DatabaseSession) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(IDENTITY_SQL, [role, JSON.stringify(claims)]);
      const result = await work(client);
      await client.query('commit');
      client.release();
      return result;
    } catch (error) {
      // A connection whose rollback failed is in an unknown state: destroy it
      // instead of returning it to the pool.
      const rolledBack = await client.query('rollback').then(
        () => true,
        () => false,
      );
      client.release(!rolledBack);
      throw error;
    }
  }
}
