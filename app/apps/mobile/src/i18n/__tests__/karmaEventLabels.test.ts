// Every karma_ledger event type the baseline writes has its own he + en label (FR-KARMA-007).
import { describe, expect, it, vi } from 'vitest';
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => ({}) }));
import { karmaReasonKey } from '../../hooks/useKarmaHistory';
import he from '../locales/he';
import en from '../locales/en';

// supabase/schemas/72_karma: the karma_values rows plus `reversal`, the entry that takes points back.
const BASELINE_EVENT_TYPES = [
  'handoff_giver', 'handoff_receiver', 'item_value_bonus', 'rating_given',
  'challenge_opened', 'challenge_report', 'challenge_completed',
  'donation', 'standing_order_month', 'reversal',
] as const;

describe('karma event labels (he/en)', () => {
  it.each(BASELINE_EVENT_TYPES)('%s has its own label', (eventType) => {
    const key = karmaReasonKey(eventType);
    expect(key).not.toBe('other');
    for (const bundle of [he, en]) {
      const label = (bundle.karma.reason as Record<string, string>)[key];
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
