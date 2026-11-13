// SupabaseStatsRepository — adapter for IStatsRepository.
// Mapped to SRS: FR-FEED-014, FR-STATS-003, FR-STATS-004.
//
// `community_stats()` (FR-STATS-004) and `my_activity_timeline` (FR-STATS-003) come with the baseline;
// the admin world-flow funnel (FR-STATS-007) and the member's per-world givings (FR-STATS-008) with
// migration 0018 (`admin_world_flow_funnel`, `my_world_givings`).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommunityStatsSnapshot, IStatsRepository, MyWorldGivings, WorldFlowFunnelRow } from '@kc/application';
import type { PersonalActivityItem, PersonalActivityKind } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

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

/** A kind the app has no label for reads as a creation, as before. */
function mapActivityKind(kind: string): PersonalActivityKind {
  return ACTIVITY_KINDS.has(kind) ? (kind as PersonalActivityKind) : 'post_created';
}

export class SupabaseStatsRepository implements IStatsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** The community counters; `refreshed_at` is when the server computed them. */
  async getCommunityStatsSnapshot(): Promise<CommunityStatsSnapshot> {
    const rows = unwrapCall('rpc:community_stats', await this.client.rpc('community_stats'));
    const row = rows?.[0];
    return {
      registeredUsers: Number(row?.registered_users ?? 0),
      activePublicPosts: Number(row?.open_public_posts ?? 0),
      itemsDeliveredTotal: Number(row?.delivered_posts ?? 0),
      asOf: row?.refreshed_at ?? null,
    };
  }

  async getActivePublicPostsCount(): Promise<number> {
    return (await this.getCommunityStatsSnapshot()).activePublicPosts;
  }

  async listMyActivityTimeline(limit: number): Promise<PersonalActivityItem[]> {
    const rows = unwrapCall(
      'rpc:my_activity_timeline',
      await this.client.rpc('my_activity_timeline', { p_limit: limit }),
    );
    return (rows ?? []).map((row) => ({
      occurredAt: row.occurred_at,
      kind: mapActivityKind(row.kind),
      postId: row.post_id,
      postTitle: row.post_title,
      actorDisplayName: row.actor_display_name,
      worldSlug: row.world_slug ?? null,
    }));
  }

  /** FR-STATS-007 — per world and direction; the handoff stages are null where they are not tracked. */
  async getWorldFlowFunnel(days: number): Promise<WorldFlowFunnelRow[]> {
    const rows = unwrapCall(
      'rpc:admin_world_flow_funnel',
      await this.client.rpc('admin_world_flow_funnel', { p_days: days }),
    ) ?? [];
    return rows.map((r) => ({
      worldSlug: r.world_slug,
      worldLabelHe: r.world_label_he,
      worldLabelEn: r.world_label_en,
      direction: r.direction === 'request' ? 'request' : 'give',
      published: Number(r.published),
      booked: toCountOrNull(r.booked),
      confirmed: toCountOrNull(r.confirmed),
      completed: toCountOrNull(r.completed),
      cancelled: toCountOrNull(r.cancelled),
      closed: Number(r.closed),
      medianHoursToBooking: toCountOrNull(r.median_hours_to_booking),
      medianHoursToCompletion: toCountOrNull(r.median_hours_to_completion),
    }));
  }

  /** FR-STATS-008 — the caller's own givings per world (the server reads the session). */
  async listMyWorldGivings(): Promise<MyWorldGivings[]> {
    const rows = unwrapCall('rpc:my_world_givings', await this.client.rpc('my_world_givings')) ?? [];
    return rows.map((r) => ({
      worldSlug: r.world_slug,
      worldLabelHe: r.world_label_he,
      worldLabelEn: r.world_label_en,
      given: Number(r.given),
      received: Number(r.received),
      closed: Number(r.closed),
    }));
  }
}

/** The generated types say number; the function returns null for a stage that is not tracked. */
function toCountOrNull(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
