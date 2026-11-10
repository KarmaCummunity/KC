// FR-VERIFY-013 — when the complete-profile nudges show.
import { describe, expect, it, vi } from 'vitest';
import type { User } from '@kc/domain';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('../../services/userComposition', () => ({ getUserRepo: vi.fn() }));
vi.mock('../../store/authStore', () => ({ useAuthStore: vi.fn() }));

import { isOwnProfileIncomplete } from '../useOwnProfileIncomplete';
import { needsIdentityVerificationReminder } from '../useOwnProfileNeedsIdentityVerification';
import { completeProfileSnoozeKey, isCompleteProfileSnoozed } from '../useCompleteProfileBanner';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-07T12:00:00Z');

const completeUser = {
  displayName: 'Nave',
  city: 'tlv',
  dateOfBirth: '1990-01-01',
  avatarUrl: 'https://example.test/a.png',
  profileStreet: 'Herzl',
  profileStreetNumber: '12',
  contactPhone: '0501234567',
  verificationLevel: 1,
} as unknown as User;

describe('isOwnProfileIncomplete', () => {
  it('is false while the profile has not loaded', () => {
    expect(isOwnProfileIncomplete(null)).toBe(false);
    expect(isOwnProfileIncomplete(undefined)).toBe(false);
  });

  it('is true at level 0 with a missing field', () => {
    expect(isOwnProfileIncomplete({ ...completeUser, verificationLevel: 0, contactPhone: null })).toBe(true);
  });

  it('is false once the server level is 1 or more', () => {
    expect(isOwnProfileIncomplete({ ...completeUser, contactPhone: null })).toBe(false);
    expect(isOwnProfileIncomplete({ ...completeUser, verificationLevel: 2, avatarUrl: null })).toBe(false);
  });

  it('is false right after the last field is saved, before the level refetch lands', () => {
    expect(isOwnProfileIncomplete({ ...completeUser, verificationLevel: 0 })).toBe(false);
  });
});

describe('needsIdentityVerificationReminder', () => {
  it('is false while profile is still incomplete', () => {
    expect(needsIdentityVerificationReminder({ ...completeUser, verificationLevel: 0, contactPhone: null })).toBe(
      false,
    );
  });

  it('is true at level 1', () => {
    expect(needsIdentityVerificationReminder(completeUser)).toBe(true);
  });

  it('is false from level 2 onward', () => {
    expect(needsIdentityVerificationReminder({ ...completeUser, verificationLevel: 2 })).toBe(false);
  });
});

describe('isCompleteProfileSnoozed', () => {
  it('is not snoozed without a stamp or with a broken one', () => {
    expect(isCompleteProfileSnoozed(null, NOW)).toBe(false);
    expect(isCompleteProfileSnoozed('not-a-date', NOW)).toBe(false);
  });

  it('stays snoozed for 7 days after closing', () => {
    expect(isCompleteProfileSnoozed(new Date(NOW - 6 * DAY).toISOString(), NOW)).toBe(true);
  });

  it('returns after 7 days', () => {
    expect(isCompleteProfileSnoozed(new Date(NOW - 7 * DAY).toISOString(), NOW)).toBe(false);
  });

  it('keys the snooze per user', () => {
    expect(completeProfileSnoozeKey('u1')).not.toBe(completeProfileSnoozeKey('u2'));
  });
});
