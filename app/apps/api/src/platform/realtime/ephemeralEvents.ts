import type { PresenceMember } from '@kc/infrastructure-api';
import { Inject, Injectable } from '@nestjs/common';
import { RealtimeHub } from './realtimeHub';

/**
 * What is sent but never stored (ADR-011 section 4): client-sent broadcasts
 * (typing) and presence. The gateway talks to this class; whether the events
 * stay on one instance or reach every instance is the implementation's.
 */
export abstract class EphemeralEvents {
  /** Sends a client's event to the topic's other subscribers; the sender does not get it back. */
  abstract broadcast(topic: string, event: string, payload: unknown, senderId: string): void;
  /** Everyone present on the topic: one entry per member, whatever number of devices they have open. */
  abstract membersOf(topic: string): Promise<PresenceMember[]>;
  /** Marks a connection's member as present on the topic. */
  abstract track(topic: string, connectionId: string, member: PresenceMember): Promise<void>;
  /** Removes a connection's presence; the topic hears a leave when the member's last connection is gone. */
  abstract untrack(topic: string, connectionId: string, key: string): Promise<void>;
}

/**
 * Serves one instance: events go straight to the hub and presence is kept in
 * memory. Used where one process is the whole server (tests, a local run).
 */
@Injectable()
export class InMemoryEphemeralEvents extends EphemeralEvents {
  /** topic → member key (user id) → connection id → what that connection shows. */
  private readonly present = new Map<string, Map<string, Map<string, PresenceMember['meta']>>>();

  constructor(@Inject(RealtimeHub) private readonly hub: RealtimeHub) {
    super();
  }

  broadcast(topic: string, event: string, payload: unknown, senderId: string): void {
    this.hub.deliver(topic, 'broadcast', { op: 'event', topic, event, payload }, senderId);
  }

  membersOf(topic: string): Promise<PresenceMember[]> {
    return Promise.resolve([...(this.present.get(topic) ?? [])].map(([key, connections]) => ({ key, meta: latestMeta(connections) })));
  }

  /** The topic hears a join only for the member's first connection. */
  track(topic: string, connectionId: string, member: PresenceMember): Promise<void> {
    const members = this.present.get(topic) ?? new Map<string, Map<string, PresenceMember['meta']>>();
    const connections = members.get(member.key) ?? new Map<string, PresenceMember['meta']>();
    const isFirst = connections.size === 0;
    connections.set(connectionId, member.meta);
    members.set(member.key, connections);
    this.present.set(topic, members);
    if (isFirst) this.hub.deliver(topic, 'presence', { op: 'presence_diff', topic, joins: [member], leaves: [] });
    return Promise.resolve();
  }

  untrack(topic: string, connectionId: string, key: string): Promise<void> {
    const members = this.present.get(topic);
    const connections = members?.get(key);
    if (!members || !connections?.has(connectionId)) return Promise.resolve();
    const meta = connections.get(connectionId) ?? {};
    connections.delete(connectionId);
    if (connections.size > 0) return Promise.resolve();
    members.delete(key);
    if (members.size === 0) this.present.delete(topic);
    this.hub.deliver(topic, 'presence', { op: 'presence_diff', topic, joins: [], leaves: [{ key, meta }] });
    return Promise.resolve();
  }
}

/** The meta of the connection that tracked last: a `Map` keeps insertion order. */
function latestMeta(connections: ReadonlyMap<string, PresenceMember['meta']>): PresenceMember['meta'] {
  let latest: PresenceMember['meta'] = {};
  for (const meta of connections.values()) latest = meta;
  return latest;
}
