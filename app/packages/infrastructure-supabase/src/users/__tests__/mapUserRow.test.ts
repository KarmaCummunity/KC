import { describe, it, expect } from 'vitest';
import { mapUserRow, type UserRow } from '../mapUserRow';

function makeRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    user_id: 'u_1',
    auth_provider: 'google',
    share_handle: 'alice',
    display_name: 'Alice',
    city: 'IL-001',
    city_name: 'Tel Aviv',
    profile_street: 'Allenby',
    profile_street_number: '12',
    biography: 'I give books.',
    avatar_url: 'https://cdn.example.com/avatars/u_1.jpg',
    privacy_mode: 'Public',
    privacy_changed_at: '2026-04-01T12:00:00.000Z',
    account_status: 'active',
    onboarding_state: 'completed',
    notification_preferences: { newFollower: true },
    is_super_admin: false,
    closure_explainer_dismissed: false,
    first_post_nudge_dismissed: false,
    items_given_count: 3,
    items_received_count: 1,
    active_posts_count_internal: 2,
    followers_count: 7,
    following_count: 4,
    karma_points: 5,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('mapUserRow', () => {
  it('maps every column to its domain field on the happy path', () => {
    const out = mapUserRow(makeRow());

    expect(out).toEqual({
      userId: 'u_1',
      authProvider: 'google',
      shareHandle: 'alice',
      displayName: 'Alice',
      city: 'IL-001',
      cityName: 'Tel Aviv',
      profileStreet: 'Allenby',
      profileStreetNumber: '12',
      contactPhone: null,
      dateOfBirth: null,
      biography: 'I give books.',
      avatarUrl: 'https://cdn.example.com/avatars/u_1.jpg',
      privacyMode: 'Public',
      privacyChangedAt: '2026-04-01T12:00:00.000Z',
      accountStatus: 'active',
      onboardingState: 'completed',
      notificationPreferences: { newFollower: true },
      isSuperAdmin: false,
      closureExplainerDismissed: false,
      firstPostNudgeDismissed: false,
      itemsGivenCount: 3,
      itemsReceivedCount: 1,
      activePostsCountInternal: 2,
      followersCount: 7,
      followingCount: 4,
      karmaPoints: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      preferredLanguage: null,
    });
  });

  it('maps karma_points → karmaPoints (FR-KARMA-001)', () => {
    expect(mapUserRow(makeRow({ karma_points: 42 })).karmaPoints).toBe(42);
  });

  describe('optional profile address columns', () => {
    it('defaults profile_street/profile_street_number to null when undefined', () => {
      // The columns are optional on the row interface (omitted from older
      // queries that don't select them); the mapper must coalesce to null.
      const out = mapUserRow(makeRow({
        profile_street: undefined,
        profile_street_number: undefined,
      }));

      expect(out.profileStreet).toBeNull();
      expect(out.profileStreetNumber).toBeNull();
    });

    it('preserves explicit null on profile_street/profile_street_number', () => {
      const out = mapUserRow(makeRow({
        profile_street: null,
        profile_street_number: null,
      }));

      expect(out.profileStreet).toBeNull();
      expect(out.profileStreetNumber).toBeNull();
    });

    it('passes through populated profile address values', () => {
      const out = mapUserRow(makeRow({
        profile_street: 'Dizengoff',
        profile_street_number: '99B',
      }));

      expect(out.profileStreet).toBe('Dizengoff');
      expect(out.profileStreetNumber).toBe('99B');
    });
  });

  describe('nullable presentation fields', () => {
    it('passes biography null through verbatim', () => {
      const out = mapUserRow(makeRow({ biography: null }));
      expect(out.biography).toBeNull();
    });

    it('passes avatar_url null through verbatim', () => {
      const out = mapUserRow(makeRow({ avatar_url: null }));
      expect(out.avatarUrl).toBeNull();
    });

    it('passes privacy_changed_at null through verbatim', () => {
      const out = mapUserRow(makeRow({ privacy_changed_at: null }));
      expect(out.privacyChangedAt).toBeNull();
    });

    // Migration 0084 — display_name/city/city_name nullable in pending_basic_info; UI fallbacks.
    it('passes display_name / city / city_name null through verbatim (migration 0084)', () => {
      const out = mapUserRow(makeRow({ display_name: null, city: null, city_name: null }));
      expect(out.displayName).toBeNull();
      expect(out.city).toBeNull();
      expect(out.cityName).toBeNull();
    });
  });

  describe('opaque enum / json casts', () => {
    it('forwards the raw auth_provider string (cast to AuthProvider on the way out)', () => {
      // The mapper does not validate the enum value — the DB CHECK constraint
      // is the source of truth. If a future provider is added at the DB layer,
      // the mapper must not block reads.
      const out = mapUserRow(makeRow({ auth_provider: 'apple' }));
      expect(out.authProvider).toBe('apple');
    });

    // TD-69 (audit 2026-05-16): privacy_mode narrowed to the D-21 union;
    // unknown / legacy values collapse to 'Public'.
    it.each([
      ['Private', 'Private'],
      ['Public', 'Public'],
      ['Followers', 'Public'], // pre-D-21 legacy value
      ['someUnexpectedValue', 'Public'],
    ])('narrows privacy_mode %s → %s', (raw, expected) => {
      expect(mapUserRow(makeRow({ privacy_mode: raw })).privacyMode).toBe(expected);
    });

    it('forwards the raw account_status string', () => {
      const out = mapUserRow(makeRow({ account_status: 'pending_verification' }));
      expect(out.accountStatus).toBe('pending_verification');
    });

    it('forwards the raw onboarding_state string', () => {
      const out = mapUserRow(makeRow({ onboarding_state: 'pending_basic_info' }));
      expect(out.onboardingState).toBe('pending_basic_info');
    });

    it('passes notification_preferences through without coercion (opaque JSON column)', () => {
      const prefs = { newFollower: false, newMessage: true, extra: 'ignored' };
      const out = mapUserRow(makeRow({ notification_preferences: prefs }));
      // Pass-through: the same reference, not a copy.
      expect(out.notificationPreferences).toBe(prefs);
    });
  });

  describe('counter fields', () => {
    it('preserves zero counter values', () => {
      const out = mapUserRow(makeRow({
        items_given_count: 0,
        items_received_count: 0,
        active_posts_count_internal: 0,
        followers_count: 0,
        following_count: 0,
      }));

      expect(out.itemsGivenCount).toBe(0);
      expect(out.itemsReceivedCount).toBe(0);
      expect(out.activePostsCountInternal).toBe(0);
      expect(out.followersCount).toBe(0);
      expect(out.followingCount).toBe(0);
    });
  });

  describe('boolean flags', () => {
    it('forwards is_super_admin true', () => {
      const out = mapUserRow(makeRow({ is_super_admin: true }));
      expect(out.isSuperAdmin).toBe(true);
    });

    it('forwards both dismissal flags', () => {
      const out = mapUserRow(makeRow({
        closure_explainer_dismissed: true,
        first_post_nudge_dismissed: true,
      }));

      expect(out.closureExplainerDismissed).toBe(true);
      expect(out.firstPostNudgeDismissed).toBe(true);
    });
  });

  describe('mapUserRow — preferredLanguage (FR-TRANSLATE-003)', () => {
    it('maps preferred_language when present', () => {
      expect(mapUserRow(makeRow({ preferred_language: 'ru' })).preferredLanguage).toBe('ru');
    });

    it('defaults to null when absent', () => {
      expect(mapUserRow(makeRow()).preferredLanguage).toBeNull();
    });
  });
});
