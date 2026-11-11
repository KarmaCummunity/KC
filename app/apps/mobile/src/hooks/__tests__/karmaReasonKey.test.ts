import { describe, expect, it, vi } from 'vitest';
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => ({}) }));
import { karmaReasonKey } from '../useKarmaHistory';
import { karmaEventIcon } from '../../components/profile/karmaHistoryIcon';
import he from '../../i18n/locales/he';
import en from '../../i18n/locales/en';

// Event types the baseline writes to karma_ledger (supabase/schemas/72_karma): the
// karma_values rows plus `reversal`, the entry that takes points back.
const BASELINE_EVENT_TYPES = [
  'handoff_giver', 'handoff_receiver', 'item_value_bonus', 'rating_given',
  'challenge_opened', 'challenge_report', 'challenge_completed',
  'donation', 'standing_order_month', 'reversal',
] as const;

describe('karmaReasonKey', () => {
  it('maps known and unknown events', () => {
    expect(karmaReasonKey('closure_giver')).toBe('closure_giver');
    expect(karmaReasonKey('something_new')).toBe('other');
  });

  it('labels the rating-given award (KC#1306)', () => {
    expect(karmaReasonKey('rating_given')).toBe('rating_given');
  });

  it.each(BASELINE_EVENT_TYPES)('gives the baseline event %s its own label in he and en', (eventType) => {
    const key = karmaReasonKey(eventType);
    expect(key).not.toBe('other');
    for (const bundle of [he, en]) {
      const label = (bundle.karma.reason as Record<string, string>)[key];
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('karmaEventIcon', () => {
  it.each([
    ['handoff_giver', 'gift-outline'],
    ['item_value_bonus', 'gift-outline'],
    ['challenge_completed', 'trophy-outline'],
    ['donation', 'heart-outline'],
    ['standing_order_month', 'heart-outline'],
    ['reversal', 'arrow-undo-outline'],
    ['something_new', 'star-outline'],
  ])('%s shows %s', (eventType, icon) => {
    expect(karmaEventIcon(eventType)).toBe(icon);
  });
});
