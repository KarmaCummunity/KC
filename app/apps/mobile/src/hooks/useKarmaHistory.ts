// FR-KARMA-007 — self karma ledger (RLS: karma_ledger_select_own), newest first.
import { useQuery } from '@tanstack/react-query';
import type { IKarmaHistoryRepository, KarmaHistoryEntry } from '@kc/application';
import { getSupabaseClient, SupabaseKarmaHistoryRepository } from '@kc/infrastructure-supabase';
import { viaApi } from '../services/backend/apiBackend';

/** One row of the history screen. */
export type KarmaHistoryRow = KarmaHistoryEntry;

/** Rows the history screen shows at most. */
const HISTORY_LIMIT = 300;

let repository: IKarmaHistoryRepository | null = null;
function karmaHistoryRepository(): IKarmaHistoryRepository {
  repository ??= viaApi('karmaHistory', new SupabaseKarmaHistoryRepository(getSupabaseClient()));
  return repository;
}

export function useKarmaHistory(userId: string | undefined) {
  return useQuery({
    queryKey: ['karma-history', userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: (): Promise<KarmaHistoryRow[]> => karmaHistoryRepository().listHistory(userId!, HISTORY_LIMIT),
  });
}

/** Ledger event types that have a label of their own (the locale's `karma.reason.*`). */
const KNOWN = new Set([
  'registration', 'post_created', 'post_removed', 'outreach', 'follower_gained', 'follower_gained_reverse',
  'closure_giver', 'closure_receiver', 'giving_handoff_giver', 'giving_handoff_receiver',
  'listing_fulfilled', 'volunteer_checkin', 'backfill', 'rating_given',
  // Baseline awards (supabase/schemas/72_karma) and the entry that takes points back.
  'item_value_bonus', 'challenge_opened', 'challenge_report', 'challenge_completed',
  'donation', 'standing_order_month', 'reversal',
]);

/** The baseline's awards that share the label of the same award in the old vocabulary. */
const ALIASES: Readonly<Record<string, string>> = {
  handoff_giver: 'giving_handoff_giver',
  handoff_receiver: 'giving_handoff_receiver',
  // Publishing a post (FR-KARMA-005).
  post_published: 'post_created',
};

/** i18n key suffix for a ledger event type (unknown types map to `other`). */
export function karmaReasonKey(eventType: string): string {
  const key = ALIASES[eventType] ?? eventType;
  return KNOWN.has(key) ? key : 'other';
}
