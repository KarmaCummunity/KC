import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@kc/domain';
import {
  fetchUsersSelfPrivateFields,
  mergeSelfPrivateFields,
  type UsersSelfPrivateSlice,
} from '../usersSelfPrivateFields';

const BASE_USER: User = {
  userId: 'u_1',
  authProvider: 'phone',
  shareHandle: 'alice',
  displayName: 'Alice',
  city: '5000',
  cityName: 'Tel Aviv',
  contactPhone: null,
  dateOfBirth: null,
  profileStreet: null,
  profileStreetNumber: null,
  biography: null,
  avatarUrl: null,
  privacyMode: 'Public',
  privacyChangedAt: null,
  accountStatus: 'active',
  onboardingState: 'completed',
  notificationPreferences: { marketing: false, transactional: true } as unknown as User['notificationPreferences'],
  isSuperAdmin: false,
  closureExplainerDismissed: false,
  firstPostNudgeDismissed: false,
  itemsGivenCount: 0,
  itemsReceivedCount: 0,
  activePostsCountInternal: 0,
  followersCount: 0,
  followingCount: 0,
  karmaPoints: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  preferredLanguage: null,
};

describe('usersSelfPrivateFields', () => {
  describe('fetchUsersSelfPrivateFields', () => {
    it('calls users_get_self_private_fields RPC and returns data slice', async () => {
      const slice: UsersSelfPrivateSlice = {
        contact_phone: '+972501111111',
        profile_street: 'Rothschild',
        profile_street_number: '12',
        notification_preferences: { push: true },
        is_super_admin: true,
        active_posts_count_internal: 5,
        karma_points: 150,
        date_of_birth: null,
      };
      const rpc = vi.fn().mockResolvedValue({ data: slice, error: null });
      const client = { rpc } as unknown as SupabaseClient;

      const result = await fetchUsersSelfPrivateFields(client);
      expect(rpc).toHaveBeenCalledWith('users_get_self_private_fields');
      expect(result).toEqual(slice);
    });

    it('returns null when RPC returns null data', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
      const client = { rpc } as unknown as SupabaseClient;

      const result = await fetchUsersSelfPrivateFields(client);
      expect(result).toBeNull();
    });

    it('throws when RPC returns an error', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'auth required' },
      });
      const client = { rpc } as unknown as SupabaseClient;

      await expect(fetchUsersSelfPrivateFields(client)).rejects.toThrow(
        'users_get_self_private_fields: auth required',
      );
    });
  });

  describe('mergeSelfPrivateFields', () => {
    it('merges slice fields into user entity', () => {
      const slice: UsersSelfPrivateSlice = {
        contact_phone: '+972502222222',
        profile_street: 'Dizengoff',
        profile_street_number: '45',
        notification_preferences: { email: true },
        is_super_admin: true,
        active_posts_count_internal: 8,
        karma_points: 200,
        date_of_birth: '1990-05-15',
      };

      const merged = mergeSelfPrivateFields(BASE_USER, slice);

      expect(merged.contactPhone).toBe('+972502222222');
      expect(merged.profileStreet).toBe('Dizengoff');
      expect(merged.profileStreetNumber).toBe('45');
      expect(merged.isSuperAdmin).toBe(true);
      expect(merged.activePostsCountInternal).toBe(8);
      expect(merged.karmaPoints).toBe(200);
      expect(merged.dateOfBirth).toBe('1990-05-15');
    });

    it('handles nullable/falsy fields with appropriate fallbacks', () => {
      const slice: UsersSelfPrivateSlice = {
        contact_phone: null,
        profile_street: null,
        profile_street_number: null,
        notification_preferences: null,
        is_super_admin: false,
        active_posts_count_internal: 0,
        karma_points: null as unknown as number,
        date_of_birth: null,
      };

      const merged = mergeSelfPrivateFields(BASE_USER, slice);

      expect(merged.contactPhone).toBeNull();
      expect(merged.profileStreet).toBeNull();
      expect(merged.profileStreetNumber).toBeNull();
      expect(merged.karmaPoints).toBe(0);
    });
  });
});
