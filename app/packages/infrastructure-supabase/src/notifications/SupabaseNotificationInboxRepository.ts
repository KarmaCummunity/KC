// In-app notification centre over the RPCs of the production baseline:
// notifications_page, notifications_unread_count, notifications_mark_read,
// notifications_mark_all_read (supabase/schemas/50_notifications/040_notification_rpcs.sql).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboxNotification, NotificationArgs, NotificationCategory } from '@kc/domain';
import type { INotificationInboxRepository, NotificationInboxPageRequest } from '@kc/application';
import type { Database } from '../database.legacy.types';

interface NotificationRow {
  id: string;
  kind: string;
  category: string;
  world_slug: string | null;
  entity_type: string | null;
  entity_id: string | null;
  title_key: string;
  body_key: string;
  data: unknown;
  group_count: number;
  read_at: string | null;
  created_at: string;
  actor_display_name: string | null;
  actor_avatar_url: string | null;
}

/** Keeps the scalar entries of `data`: ids and statuses, the only values the app reads. */
function toArgs(data: unknown): NotificationArgs {
  const args: Record<string, string | number | boolean> = {};
  if (data === null || typeof data !== 'object') return args;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') args[key] = value;
  }
  return args;
}

function mapRow(row: NotificationRow): InboxNotification {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category as NotificationCategory,
    worldSlug: row.world_slug,
    entity: row.entity_type && row.entity_id ? { type: row.entity_type, id: row.entity_id } : null,
    titleKey: row.title_key,
    bodyKey: row.body_key,
    args: toArgs(row.data),
    groupCount: row.group_count,
    actorDisplayName: row.actor_display_name,
    actorAvatarUrl: row.actor_avatar_url,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export class SupabaseNotificationInboxRepository implements INotificationInboxRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  private async call(fn: string, args?: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.client.rpc(fn as never, args as never);
    if (error) throw error;
    return data;
  }

  async page(request: NotificationInboxPageRequest = {}): Promise<InboxNotification[]> {
    const rows = await this.call('notifications_page', {
      p_limit: request.limit ?? 30,
      p_before_created_at: request.before?.createdAt ?? null,
      p_before_id: request.before?.id ?? null,
      p_category: request.category ?? null,
    });
    return ((rows ?? []) as NotificationRow[]).map(mapRow);
  }

  async unreadCount(): Promise<number> {
    return Number((await this.call('notifications_unread_count')) ?? 0);
  }

  async markRead(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return Number((await this.call('notifications_mark_read', { p_ids: [...ids] })) ?? 0);
  }

  async markAllRead(): Promise<number> {
    return Number((await this.call('notifications_mark_all_read')) ?? 0);
  }
}
