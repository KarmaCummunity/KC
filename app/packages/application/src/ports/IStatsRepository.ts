// IStatsRepository — port for community-wide stats reads (FR-FEED-014, FR-STATS-004)
// and personal activity timeline (FR-STATS-003).
//
// Adapter reads from the `community_stats` view created in migration 0006.
// Community numbers are always fresh at read time; FR-STATS-004 AC2 expects
// ~60s client-side refresh (TanStack Query refetchInterval).
//
// Activity timeline is served by `rpc_my_activity_timeline` (migration 0030).

import type { PersonalActivityItem } from '@kc/domain';

export interface CommunityStatsSnapshot {
  readonly registeredUsers: number;
  readonly activePublicPosts: number;
  readonly itemsDeliveredTotal: number;
  /** Server clock at read time (ISO), when the view exposes it. */
  readonly asOf: string | null;
}

/** FR-STATS-007 — one world and direction of the platform flow funnel (admin_world_flow_funnel, 0542). */
export interface WorldFlowFunnelRow {
  readonly worldSlug: string;
  readonly worldLabelHe: string;
  readonly worldLabelEn: string;
  readonly direction: 'give' | 'request';
  readonly published: number;
  /** Handoff stages are null for worlds that do not hand off through giving handoffs. */
  readonly booked: number | null;
  readonly confirmed: number | null;
  readonly completed: number | null;
  readonly cancelled: number | null;
  readonly closed: number;
  readonly medianHoursToBooking: number | null;
  readonly medianHoursToCompletion: number | null;
}

/** FR-STATS-008 — the signed-in member's own givings in one world (my_world_givings, 0547). */
export interface MyWorldGivings {
  readonly worldSlug: string;
  readonly worldLabelHe: string;
  readonly worldLabelEn: string;
  readonly given: number;
  readonly received: number;
  readonly closed: number;
}

export interface IStatsRepository {
  /**
   * Count of currently open, public-visibility posts across all of Israel.
   * Used by the guest banner and the warm empty state.
   */
  getActivePublicPostsCount(): Promise<number>;

  /** Full community_stats row (FR-STATS-004 AC1). */
  getCommunityStatsSnapshot(): Promise<CommunityStatsSnapshot>;

  /** Personal activity for the signed-in user (FR-STATS-003). */
  listMyActivityTimeline(limit: number): Promise<PersonalActivityItem[]>;

  /** FR-STATS-007 — admin only: the flow funnel over listings published in the last `days`. */
  getWorldFlowFunnel(days: number): Promise<WorldFlowFunnelRow[]>;

  /** FR-STATS-008 — the signed-in member's own givings per world. */
  listMyWorldGivings(): Promise<MyWorldGivings[]>;
}
