import { describe, expect, it, vi } from 'vitest';
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => ({}) }));
import { karmaReasonKey } from '../useKarmaHistory';

describe('karmaReasonKey', () => {
  it('maps known and unknown events', () => {
    expect(karmaReasonKey('closure_giver')).toBe('closure_giver');
    expect(karmaReasonKey('something_new')).toBe('other');
  });

  it('labels the rating-given award (KC#1306)', () => {
    expect(karmaReasonKey('rating_given')).toBe('rating_given');
  });
});
