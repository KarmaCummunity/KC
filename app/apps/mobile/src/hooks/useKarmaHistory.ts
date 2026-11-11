// FR-KARMA-007 — self karma ledger (RLS: karma_ledger_select_own), newest first.
import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient, unwrapCall } from '@kc/infrastructure-supabase';

export interface KarmaHistoryRow {
  readonly id: number;
  readonly eventType: string;
  readonly delta: number;
  readonly createdAt: string;
}

/** Rows the history screen shows at most. */
const HISTORY_LIMIT = 300;

export function useKarmaHistory(userId: string | undefined) {
  return useQuery({
    queryKey: ['karma-history', userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<KarmaHistoryRow[]> => {
      const rows = unwrapCall(
        'table:karma_ledger',
        await getSupabaseClient()
          .from('karma_ledger')
          .select('id, event_type, points, created_at')
          .eq('user_id', userId!)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(HISTORY_LIMIT),
      );
      return (rows ?? []).map((r) => ({ id: r.id, eventType: r.event_type, delta: r.points, createdAt: r.created_at }));
    },
  });
}

/** Ledger event types that have a label of their own (the locale's `karma.reason.*`). */
const KNOWN = new Set([
  'registration', 'post_created', 'post_removed', 'outreach', 'follower_gained', 'follower_gained_reverse',
  'closure_giver', 'closure_receiver', 'giving_handoff_giver', 'giving_handoff_receiver',
  'listing_fulfilled', 'volunteer_checkin', 'backfill', 'rating_given',
]);

/** The baseline's handoff awards, shown with the label of the same award in the old vocabulary. */
const ALIASES: Readonly<Record<string, string>> = {
  handoff_giver: 'giving_handoff_giver',
  handoff_receiver: 'giving_handoff_receiver',
};

/** i18n key suffix for a ledger event type (unknown types map to `other`). */
export function karmaReasonKey(eventType: string): string {
  const key = ALIASES[eventType] ?? eventType;
  return KNOWN.has(key) ? key : 'other';
}
