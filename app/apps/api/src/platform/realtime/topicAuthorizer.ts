import type { RealtimeExtension } from '@kc/infrastructure-api';
import { Inject, Injectable } from '@nestjs/common';
import { type DatabaseSession, IdentityDatabase } from '../database/identityDatabase';
import type { CallerIdentity } from '../identity/callerIdentity';

/** What a caller may do on a topic. */
export interface TopicAccess {
  /** May join the topic and be sent its events. */
  readonly receive: boolean;
  /** May send an event to the topic (typing) or track their presence on it. */
  readonly send: boolean;
}

/** Longest topic the gateway looks at; every real topic is far shorter (`chat:<uuid>:messages`). */
export const MAX_TOPIC_LENGTH = 128;
/** PostgreSQL insufficient_privilege: what a refused insert under row-level security raises. */
const INSUFFICIENT_PRIVILEGE = '42501';
const NO_ACCESS: TopicAccess = { receive: false, send: false };

/**
 * Decides who may join a realtime topic, with the policies already written
 * on `realtime.messages` (ADR-011 section 2, ADR-003): a caller may receive
 * when they could read a message of that topic, and may send when they could
 * insert one. The check writes a probe row and reads it back as the caller, in
 * a transaction that is always rolled back, which is how the service this
 * replaces decides too. So a policy and its SQL test mean here what they
 * always meant, and a topic no policy names is closed to everyone.
 */
@Injectable()
export class TopicAuthorizer {
  constructor(@Inject(IdentityDatabase) private readonly database: IdentityDatabase) {}

  async accessOf(caller: CallerIdentity, topic: string, extension: RealtimeExtension): Promise<TopicAccess> {
    if (topic.length === 0 || topic.length > MAX_TOPIC_LENGTH) return NO_ACCESS;
    return this.database.inspectAsService(async (session) => {
      // The probe is written as the service role, which row-level security does not bind: it exists whatever the caller may do.
      const probe = await session.query<{ id: string }>('insert into realtime.messages (topic, extension, private) values ($1, $2, true) returning id', [topic, extension]);
      await session.query(
        "select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true), set_config('realtime.topic', $2, true)",
        [JSON.stringify(caller.claims), topic],
      );
      const visible = await session.query('select 1 from realtime.messages where id = $1', [probe.rows[0]?.id]);
      return { receive: visible.rowCount === 1, send: await this.mayInsert(session, topic, extension) };
    });
  }

  /**
   * True when the caller's own insert passes the policies. The attempt runs in
   * a savepoint, so a refusal does not end the surrounding transaction.
   */
  private async mayInsert(session: DatabaseSession, topic: string, extension: RealtimeExtension): Promise<boolean> {
    await session.query('savepoint send_probe');
    try {
      await session.query('insert into realtime.messages (topic, extension, private) values ($1, $2, true)', [topic, extension]);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code !== INSUFFICIENT_PRIVILEGE) throw error;
      await session.query('rollback to savepoint send_probe');
      return false;
    }
  }
}
