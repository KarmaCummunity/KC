import type { PresenceMember } from '@kc/infrastructure-api';
import { Inject, Injectable } from '@nestjs/common';
import { RealtimeHub } from './realtimeHub';

/**
 * What is sent but never stored (ADR-011 section 4): client-sent broadcasts
 * (typing) and presence. This implementation serves one instance: it hands
 * events straight to the hub and keeps presence in memory. With several
 * instances the same two jobs go through Redis, behind this same class.
 */
@Injectable()
export class EphemeralEvents {
  /** topic → member key (user id) → connection id → what that connection shows. */
  private readonly present = new Map<string, Map<string, Map<string, PresenceMember['meta']>>>();

  constructor(@Inject(RealtimeHub) private readonly hub: RealtimeHub) {}

  /** Sends a client's event to the topic's other subscribers; the sender does not get it back. */
  broadcast(topic: string, event: string, payload: unknown, senderId: string): void {
    this.hub.deliver(topic, 'broadcast', { op: 'event', topic, event, payload }, senderId);
  }

  /** Everyone present on the topic: one entry per member, whatever number of devices they have open. */
  membersOf(topic: string): PresenceMember[] {
    return [...(this.present.get(topic) ?? [])].map(([key, connections]) => ({ key, meta: latestMeta(connections) }));
  }

  /** Marks a connection's member as present. The topic hears a join only for the member's first connection. */
  track(topic: string, connectionId: string, member: PresenceMember): void {
    const members = this.present.get(topic) ?? new Map<string, Map<string, PresenceMember['meta']>>();
    const connections = members.get(member.key) ?? new Map<string, PresenceMember['meta']>();
    const isFirst = connections.size === 0;
    connections.set(connectionId, member.meta);
    members.set(member.key, connections);
    this.present.set(topic, members);
    if (isFirst) this.hub.deliver(topic, 'presence', { op: 'presence_diff', topic, joins: [member], leaves: [] });
  }

  /** Removes a connection's presence. The topic hears a leave only when the member's last connection is gone. */
  untrack(topic: string, connectionId: string, key: string): void {
    const members = this.present.get(topic);
    const connections = members?.get(key);
    if (!members || !connections?.has(connectionId)) return;
    const meta = connections.get(connectionId) ?? {};
    connections.delete(connectionId);
    if (connections.size > 0) return;
    members.delete(key);
    if (members.size === 0) this.present.delete(topic);
    this.hub.deliver(topic, 'presence', { op: 'presence_diff', topic, joins: [], leaves: [{ key, meta }] });
  }
}

/** The meta of the connection that tracked last: a `Map` keeps insertion order. */
function latestMeta(connections: ReadonlyMap<string, PresenceMember['meta']>): PresenceMember['meta'] {
  let latest: PresenceMember['meta'] = {};
  for (const meta of connections.values()) latest = meta;
  return latest;
}
