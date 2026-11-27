import type { Pool } from 'pg';

/** Injection token of the `SessionLiveness`. */
export const SESSION_LIVENESS = Symbol('SESSION_LIVENESS');

/** Whether a session of KC's own identity still proves its member (ADR-013 section 2). */
export interface SessionLiveness {
  /** False for a session that ended, was not refreshed within the idle limit, does not exist, or is another member's. */
  isLive(sessionId: string, userId: string): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asks the database, as the service role, in one round trip. Several
 * statements share a round trip only in the simple query protocol, which has
 * no bound parameters, so the two ids are written as literals: each is
 * checked to be a UUID first, and anything else is not asked at all.
 */
export function createSessionLiveness(pool: Pick<Pool, 'connect'>): SessionLiveness {
  return {
    async isLive(sessionId, userId) {
      if (!UUID.test(sessionId) || !UUID.test(userId)) return false;
      const client = await pool.connect();
      try {
        const results = (await client.query(
          `begin; select set_config('role', 'service_role', true); ` +
            `select kc_private.auth_session_is_live('${sessionId}'::uuid, '${userId}'::uuid) as live; commit`,
        )) as unknown as Array<{ rows: Array<{ live?: boolean }> }>;
        client.release();
        return results.some((result) => result.rows[0]?.live === true);
      } catch (error) {
        // A connection whose rollback failed is in an unknown state: destroy it instead of returning it to the pool.
        const rolledBack = await client.query('rollback').then(
          () => true,
          () => false,
        );
        client.release(!rolledBack);
        throw error;
      }
    },
  };
}
