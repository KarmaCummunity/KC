import type { RealtimeExtension, ServerFrame } from '@kc/infrastructure-api';
import { Injectable } from '@nestjs/common';

/** One connected client, as the hub sees it: something frames can be handed to. */
export interface HubSubscriber {
  /** Unique per connection on this instance. */
  readonly id: string;
  send(frame: ServerFrame): void;
}

const keyOf = (extension: RealtimeExtension, topic: string) => `${extension}:${topic}`;

/**
 * Who on this instance is subscribed to what (ADR-011). The hub holds no
 * rule: a subscriber is added only after the authorizer allowed it, and the
 * hub then hands every frame of a topic to that topic's subscribers. One
 * failing subscriber never stops the delivery to the others.
 */
@Injectable()
export class RealtimeHub {
  private readonly subscribers = new Map<string, Map<string, HubSubscriber>>();

  subscribe(subscriber: HubSubscriber, topic: string, extension: RealtimeExtension): void {
    const key = keyOf(extension, topic);
    const members = this.subscribers.get(key) ?? new Map<string, HubSubscriber>();
    members.set(subscriber.id, subscriber);
    this.subscribers.set(key, members);
  }

  unsubscribe(subscriberId: string, topic: string, extension: RealtimeExtension): void {
    const key = keyOf(extension, topic);
    const members = this.subscribers.get(key);
    if (!members?.delete(subscriberId)) return;
    // An empty topic is forgotten, so the map holds only topics someone listens to.
    if (members.size === 0) this.subscribers.delete(key);
  }

  /**
   * Hands `frame` to every subscriber of the topic on this instance.
   * @param exceptSubscriberId The connection that sent the event, which does not get its own event back.
   * @returns How many subscribers it was handed to.
   */
  deliver(topic: string, extension: RealtimeExtension, frame: ServerFrame, exceptSubscriberId?: string): number {
    let delivered = 0;
    for (const subscriber of this.subscribers.get(keyOf(extension, topic))?.values() ?? []) {
      if (subscriber.id === exceptSubscriberId) continue;
      try {
        subscriber.send(frame);
        delivered += 1;
      } catch {
        // A socket that is closing: its own close handler removes it.
      }
    }
    return delivered;
  }

  /** Topics that have at least one subscriber on this instance, for the health report. */
  get topicCount(): number {
    return this.subscribers.size;
  }
}
