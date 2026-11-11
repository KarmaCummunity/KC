// SupabaseStatsRepository — adapter for IStatsRepository.
// Mapped to SRS: FR-FEED-014, FR-STATS-003, FR-STATS-004.
//
// Reads from `community_stats` (0006) and `rpc_my_activity_timeline` (0030); FR-STATS-007 / 008
// read `admin_world_flow_funnel` (0542) and `my_world_givings` (0547).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommunityStatsSnapshot, IStatsRepository, MyWorldGivings, WorldFlowFunnelRow } from '@kc/application';
import type { PersonalActivityItem, PersonalActivityKind } from '@kc/domain';
import type { Database } from '../database.legacy.types';

const ACTIVITY_KINDS = new Set<string>([
  'post_created',
  'post_closed_delivered',
  'post_closed_no_recipient',
  'post_reopened',
  'marked_as_recipient',
  'unmarked_as_recipient',
  'post_expired',
  'post_removed_admin',
]);

type ActivityRpcRow = {
  occurred_at: string;
  kind: string;
  post_id: string;
  post_title: string;
  actor_display_name: string | null;
};

function mapActivityKind(kind: string): PersonalActivityKind {
  if (ACTIVITY_KINDS.has(kind)) return kind as PersonalActivityKind;
  return 'post_created';
}

function mapSnapshotRow(data: {
  registered_users?: number | null;
  active_public_posts?: number | null;
  items_delivered_total?: number | null;
  as_of?: string | null;
} | null): CommunityStatsSnapshot {
  return {
    registeredUsers: Number(data?.registered_users ?? 0),
    activePublicPosts: Number(data?.active_public_posts ?? 0),
    itemsDeliveredTotal: Number(data?.items_delivered_total ?? 0),
    asOf: data?.as_of ?? null,
  };
}

/** PostgREST: function missing from schema (migration not applied). */
function isActivityRpcMissing(error: { code?: string; message: string }): boolean {
  const msg = error.message.toLowerCase();
  const code = error.code ?? '';
  if (code === 'PGRST202') return true;
  if (code === '42883') return true;
  if (msg.trim() === 'not found') return true;
  if (msg.includes('rpc_my_activity_timeline') && msg.includes('could not find')) return true;
  if (msg.includes('rpc_my_activity_timeline') && msg.includes('does not exist')) return true;
  return false;
}

export class SupabaseStatsRepository implements IStatsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getCommunityStatsSnapshot(): Promise<CommunityStatsSnapshot> {
    const { data, error } = await this.client
      .from('community_stats')
      .select('registered_users, active_public_posts, items_delivered_total, as_of')
      .maybeSingle();

    if (error) throw new Error(`getCommunityStatsSnapshot: ${error.message}`);
    return mapSnapshotRow(data);
  }

  async getActivePublicPostsCount(): Promise<number> {
    const s = await this.getCommunityStatsSnapshot();
    return s.activePublicPosts;
  }

  async listMyActivityTimeline(limit: number): Promise<PersonalActivityItem[]> {
    const { data, error } = await this.client.rpc('rpc_my_activity_timeline', {
      p_limit: limit,
    });

    if (error) {
      if (isActivityRpcMissing(error)) {
        const g = globalThis as { __DEV__?: boolean };
        if (g.__DEV__) {
          console.warn(
            '[SupabaseStatsRepository] rpc_my_activity_timeline missing; apply supabase/migrations/0030_personal_activity_timeline_rpc.sql',
          );
        }
        return [];
      }
      throw new Error(`listMyActivityTimeline: ${error.message}`);
    }
    const rows = (data ?? []) as ActivityRpcRow[];
    return rows.map((r) => ({
      occurredAt: r.occurred_at,
      kind: mapActivityKind(r.kind),
      postId: r.post_id,
      postTitle: r.post_title,
      actorDisplayName: r.actor_display_name,
    }));
  }

  async getWorldFlowFunnel(days: number): Promise<WorldFlowFunnelRow[]> {
    const { data, error } = await this.client.rpc('admin_world_flow_funnel', { p_days: days });
    if (error) throw new Error(`admin_world_flow_funnel: ${error.message}`);
    return (data ?? []).map((r) => ({
      worldSlug: r.world_slug,
      worldLabelHe: r.world_label_he,
      worldLabelEn: r.world_label_en,
      direction: r.direction as WorldFlowFunnelRow['direction'],
      published: r.published,
      // Generated types say number; the function returns null outside the handoff worlds.
      booked: r.booked ?? null,
      confirmed: r.confirmed ?? null,
      completed: r.completed ?? null,
      cancelled: r.cancelled ?? null,
      closed: r.closed,
      medianHoursToBooking: r.median_hours_to_booking ?? null,
      medianHoursToCompletion: r.median_hours_to_completion ?? null,
    }));
  }

  async listMyWorldGivings(): Promise<MyWorldGivings[]> {
    const { data, error } = await this.client.rpc('my_world_givings');
    if (error) throw new Error(`my_world_givings: ${error.message}`);
    return (data ?? []).map((r) => ({
      worldSlug: r.world_slug,
      worldLabelHe: r.world_label_he,
      worldLabelEn: r.world_label_en,
      given: r.given,
      received: r.received,
      closed: r.closed,
    }));
  }
}
