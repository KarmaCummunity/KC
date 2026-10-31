// FR-KARMA-007 — self karma ledger (RLS: karma_ledger_select_self), newest first.
import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient } from '@kc/infrastructure-supabase';

export interface KarmaHistoryRow {
  readonly id: number;
  readonly eventType: string;
  readonly delta: number;
  readonly createdAt: string;
}

export function useKarmaHistory(userId: string | undefined) {
  return useQuery({
    queryKey: ['karma-history', userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<KarmaHistoryRow[]> => {
      const { data, error } = await getSupabaseClient()
        .from('karma_ledger')
        .select('ledger_id, event_type, points_delta, created_at')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .order('ledger_id', { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((r: { ledger_id: number; event_type: string; points_delta: number; created_at: string }) => ({
        id: r.ledger_id,
        eventType: r.event_type,
        delta: r.points_delta,
        createdAt: r.created_at,
      }));
    },
  });
}

const KNOWN = new Set([
  'registration', 'post_created', 'post_removed', 'outreach', 'follower_gained', 'follower_gained_reverse',
  'closure_giver', 'closure_receiver', 'giving_handoff_giver', 'giving_handoff_receiver',
  'listing_fulfilled', 'volunteer_checkin', 'backfill', 'rating_given',
]);

/** i18n key suffix for a ledger event type (unknown types map to `other`). */
export function karmaReasonKey(eventType: string): string {
  return KNOWN.has(eventType) ? eventType : 'other';
}
