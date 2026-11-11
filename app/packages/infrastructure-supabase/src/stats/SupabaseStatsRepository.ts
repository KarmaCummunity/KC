// SupabaseStatsRepository — adapter for IStatsRepository.
// Mapped to SRS: FR-FEED-014, FR-STATS-003, FR-STATS-004.
//
// `community_stats()` (FR-STATS-004) and `my_activity_timeline` (FR-STATS-003) exist in the baseline.
// The admin world-flow funnel (FR-STATS-007, M14) and the member's per-world givings (FR-STATS-008,
// M15) do not: they throw `BackendUnavailableError` and the statistics screen hides those blocks.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommunityStatsSnapshot, IStatsRepository, MyWorldGivings, WorldFlowFunnelRow } from '@kc/application';
import { BackendUnavailableError, type PersonalActivityItem, type PersonalActivityKind } from '@kc/domain';
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

  /** M14: the platform funnel report is not built; the admin statistics screen hides it. */
  async getWorldFlowFunnel(_days: number): Promise<WorldFlowFunnelRow[]> {
    throw new BackendUnavailableError('rpc:admin_world_flow_funnel', 'function');
  }

  /** M15: the per-world giving totals are not built; the statistics screen hides the block. */
  async listMyWorldGivings(): Promise<MyWorldGivings[]> {
    throw new BackendUnavailableError('rpc:my_world_givings', 'function');
  }
}
