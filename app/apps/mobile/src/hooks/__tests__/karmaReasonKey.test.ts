import { describe, expect, it, vi } from 'vitest';
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => ({}) }));
import { karmaReasonKey } from '../useKarmaHistory';
import { karmaEventIcon } from '../../components/profile/karmaHistoryIcon';

describe('karmaReasonKey', () => {
  it('maps known and unknown events', () => {
    expect(karmaReasonKey('closure_giver')).toBe('closure_giver');
    expect(karmaReasonKey('something_new')).toBe('other');
  });

  it('labels the rating-given award (KC#1306)', () => {
    expect(karmaReasonKey('rating_given')).toBe('rating_given');
  });

  // Baseline ledger event types (supabase/schemas/72_karma); labels: i18n/__tests__/karmaEventLabels.test.ts.
  it.each(['item_value_bonus', 'challenge_completed', 'donation', 'reversal'])('labels the baseline event %s', (eventType) => {
    expect(karmaReasonKey(eventType)).toBe(eventType);
  });

  it('shows the baseline handoff awards with the giving labels', () => {
    expect(karmaReasonKey('handoff_giver')).toBe('giving_handoff_giver');
    expect(karmaReasonKey('handoff_receiver')).toBe('giving_handoff_receiver');
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
