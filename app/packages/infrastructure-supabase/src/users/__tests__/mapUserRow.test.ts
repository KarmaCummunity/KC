import { describe, it, expect } from 'vitest';
import { mapUserRow, toNotificationPreferences, type OwnerSlice, type UserRow, type UserStatsRow } from '../mapUserRow';

const ROW: UserRow = {
  id: 'u1',
  share_handle: 'dana',
  display_name: 'Dana',
  biography: 'bio',
  avatar_url: 'https://cdn/a.jpg',
  city_id: '5000',
  privacy_mode: 'Private',
  privacy_changed_at: '2026-05-01T00:00:00Z',
  verification_level: 2,
  preferred_language: 'he',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
};

const STATS: UserStatsRow = {
  user_id: 'u1',
  followers_count: 5,
  following_count: 6,
  items_given_count: 3,
  items_received_count: 2,
  open_posts_public: 4,
  open_posts_followers_only: 1,
  karma_points: 40,
};

const OWNER: OwnerSlice = {
  account: {
    status: 'pending_verification',
    statusUntil: null,
    onboardingState: 'pending_avatar',
    deletionRequestedAt: null,
    deletionPurgeAt: null,
  },
  privateProfile: {
    contactPhone: '050-1234567',
    dateOfBirth: '1990-05-15',
    profileStreet: 'Herzl',
    profileStreetNumber: '12',
    notificationPreferences: { critical: false, kinds: { chat_message: false } },
    showActiveStatus: true,
    closureExplainerDismissed: true,
    firstPostNudgeDismissed: true,
    basicInfoSkipped: false,
  },
  adminRoles: ['super_admin'],
};

describe('mapUserRow — another member', () => {
  const user = mapUserRow(ROW, { cityName: 'Tel Aviv', stats: STATS, owner: null });

  it('maps the public profile and the counters', () => {
    expect(user).toMatchObject({
      userId: 'u1',
      shareHandle: 'dana',
      displayName: 'Dana',
      city: '5000',
      cityName: 'Tel Aviv',
      biography: 'bio',
      avatarUrl: 'https://cdn/a.jpg',
      privacyMode: 'Private',
      verificationLevel: 2,
      followersCount: 5,
      followingCount: 6,
      itemsGivenCount: 3,
      itemsReceivedCount: 2,
      karmaPoints: 40,
      preferredLanguage: 'he',
    });
  });

  it('leaves every private field neutral (TD-39 / TD-163)', () => {
    expect(user).toMatchObject({
      contactPhone: null,
      dateOfBirth: null,
      profileStreet: null,
      profileStreetNumber: null,
      isSuperAdmin: false,
      activePostsCountInternal: 0,
      closureExplainerDismissed: false,
      firstPostNudgeDismissed: false,
      notificationPreferences: { critical: true, social: true },
    });
  });

  it('reads as an active, onboarded member (a visible profile is an active one)', () => {
    expect(user.accountStatus).toBe('active');
    expect(user.onboardingState).toBe('completed');
  });

  it('defaults counters to 0 and the city name to null when their rows are missing', () => {
    const bare = mapUserRow({ ...ROW, city_id: null }, { cityName: null, stats: null, owner: null });
    expect(bare).toMatchObject({ city: null, cityName: null, followersCount: 0, karmaPoints: 0 });
  });

  it('collapses an out-of-union privacy mode to Public', () => {
    expect(mapUserRow({ ...ROW, privacy_mode: 'Followers' }, { cityName: null, stats: null, owner: null }).privacyMode).toBe(
      'Public',
    );
  });
});

describe('mapUserRow — the caller\'s own row', () => {
  const user = mapUserRow(ROW, { cityName: 'Tel Aviv', stats: STATS, owner: OWNER });

  it('carries the private profile', () => {
    expect(user).toMatchObject({
      contactPhone: '050-1234567',
      dateOfBirth: '1990-05-15',
      profileStreet: 'Herzl',
      profileStreetNumber: '12',
      closureExplainerDismissed: true,
      firstPostNudgeDismissed: true,
    });
  });

  it('carries the account state and the staff role', () => {
    expect(user.accountStatus).toBe('pending_verification');
    expect(user.onboardingState).toBe('pending_avatar');
    expect(user.isSuperAdmin).toBe(true);
  });

  it('counts the open posts that are not OnlyMe (that counter is not client-readable)', () => {
    expect(user.activePostsCountInternal).toBe(5);
  });

  it('is not a super admin without the role', () => {
    expect(mapUserRow(ROW, { cityName: null, stats: STATS, owner: { ...OWNER, adminRoles: ['support'] } }).isSuperAdmin).toBe(
      false,
    );
  });
});

describe('toNotificationPreferences', () => {
  it('defaults critical and social to on for an empty document', () => {
    expect(toNotificationPreferences({})).toEqual({ critical: true, social: true });
  });

  it('honours explicit opt-outs and keeps quiet hours and per-kind settings', () => {
    const quietHours = { enabled: true, start: '22:00', end: '07:00', timezone: 'Asia/Jerusalem' };
    expect(toNotificationPreferences({ critical: false, social: true, quietHours, kinds: { chat_message: false } })).toEqual({
      critical: false,
      social: true,
      quietHours,
      kinds: { chat_message: false },
    });
  });
});
