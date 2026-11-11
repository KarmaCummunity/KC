// ─────────────────────────────────────────────
// SupabaseUserRepository — adapter for IUserRepository over the baseline identity tables
// (users, user_private, user_account, user_stats) and RPCs (docs/db/target-design.md §9).
// docs/spec/requirements/01_auth_and_onboarding.md
// ─────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IUserRepository, NotificationPreferencesPatch, OnboardingBootstrap } from '@kc/application';
import { DeleteAccountError } from '@kc/application';
import type { NotificationPreferences, OnboardingState, PrivacyMode, User } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import {
  supabaseClearBasicInfoSkipped,
  supabaseGetOnboardingBootstrap,
  supabaseMarkBasicInfoSkipped,
  supabaseSetBasicInfo,
  supabaseSetDateOfBirth,
  supabaseSetOnboardingState,
} from './onboardingSupabase';
import {
  supabaseGetEditableProfile,
  supabaseSetContactPhone,
  supabaseSetProfileAddressLines,
  supabaseUpdateEditableProfile,
  type EditableProfilePatch,
} from './editableProfileSupabase';
import { toNotificationPreferences } from './mapUserRow';
import { fetchUserBy } from './userReads';
import { getChatCounterpartyContact } from './getChatCounterpartyContact';
import { searchUsers } from './searchUsers';
import { mergeNotificationPreferences } from './notificationPreferencesMerge';
import { updateUserPrivate } from './ownPrivateUpdate';
import { updateOwnUser } from './ownUserUpdate';
import { mapRuleErrors } from '../auth/ruleErrors';
import {
  followEdge,
  unfollowEdge,
  isFollowingEdge,
  listFollowers,
  listFollowing,
} from './follow/followMethods';
import {
  sendRequest,
  cancelRequest,
  acceptRequest,
  rejectRequest,
  listPendingRaw,
  listPendingWithUsers,
} from './follow/followRequestMethods';
import { fetchFollowStateRaw } from './follow/getFollowState';
import { mapFollowError } from './follow/mapFollowError';

const NOT_IMPL = (name: string, slice: string) =>
  new Error(`SupabaseUserRepository.${name}: not_implemented (${slice})`);

export class SupabaseUserRepository implements IUserRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  // ── Onboarding (P0.3 slice A) ────────────────────────────────────────────

  /** The server reads the identity from the session, so `_userId` is not sent. */
  getOnboardingBootstrap(_userId: string): Promise<OnboardingBootstrap> {
    return supabaseGetOnboardingBootstrap(this.client);
  }

  markBasicInfoSkipped(userId: string): Promise<void> {
    return supabaseMarkBasicInfoSkipped(this.client, userId);
  }

  clearBasicInfoSkipped(userId: string): Promise<void> {
    return supabaseClearBasicInfoSkipped(this.client, userId);
  }

  setBasicInfo(userId: string, params: { displayName: string; city: string }): Promise<void> {
    return supabaseSetBasicInfo(this.client, userId, params);
  }

  setOnboardingState(state: OnboardingState): Promise<void> {
    return supabaseSetOnboardingState(this.client, state);
  }

  setAvatar(userId: string, avatarUrl: string | null): Promise<void> {
    return updateOwnUser(this.client, userId, { avatar_url: avatarUrl });
  }

  setBiography(userId: string, biography: string | null): Promise<void> {
    return updateOwnUser(this.client, userId, { biography });
  }

  /** FR-PROFILE-005 / 006 — `set_privacy_mode`; going public accepts every pending request. */
  async setPrivacyMode(userId: string, mode: PrivacyMode): Promise<User> {
    await mapRuleErrors(
      async () => unwrapCall('rpc:set_privacy_mode', await this.client.rpc('set_privacy_mode', { p_mode: mode })),
      (_reason, error) => mapFollowError(error),
    );
    const user = await fetchUserBy(this.client, 'id', userId);
    if (!user) throw new Error('setPrivacyMode: profile not found');
    return user;
  }

  /** FR-CLOSURE-004 AC3 — flips user_private.closure_explainer_dismissed = true. */
  dismissClosureExplainer(userId: string): Promise<void> {
    return updateUserPrivate(this.client, userId, { closure_explainer_dismissed: true });
  }

  /** FR-FEED-015 AC3 — flips user_private.first_post_nudge_dismissed = true. */
  dismissFirstPostNudge(userId: string): Promise<void> {
    return updateUserPrivate(this.client, userId, { first_post_nudge_dismissed: true });
  }

  setProfileAddressLines(
    userId: string,
    street: string | null,
    streetNumber: string | null,
  ): Promise<void> {
    return supabaseSetProfileAddressLines(this.client, userId, street, streetNumber);
  }

  setContactPhone(userId: string, contactPhone: string | null): Promise<void> {
    return supabaseSetContactPhone(this.client, userId, contactPhone);
  }

  setDateOfBirth(isoDate: string): Promise<void> {
    return supabaseSetDateOfBirth(this.client, isoDate);
  }

  updateEditableProfile(userId: string, patch: EditableProfilePatch): Promise<void> {
    return supabaseUpdateEditableProfile(this.client, userId, patch);
  }

  getEditableProfile(userId: string) {
    return supabaseGetEditableProfile(this.client, userId);
  }

  // ── Profile reads ────────────────────────────────────────────────────────

  findById(userId: string): Promise<User | null> {
    return fetchUserBy(this.client, 'id', userId);
  }

  findByHandle(handle: string): Promise<User | null> {
    return fetchUserBy(this.client, 'share_handle', handle);
  }

  /** FR-CHAT-014 AC7 — counterpart contact_phone when viewer is a chat participant. */
  getChatCounterpartyContact(chatId: string): Promise<string | null> {
    return getChatCounterpartyContact(this.client, chatId);
  }

  create(): Promise<never> {
    return Promise.reject(NOT_IMPL('create', 'auto-created by handle_new_auth_user trigger'));
  }
  update(): Promise<never> {
    return Promise.reject(NOT_IMPL('update', 'P2.4'));
  }
  delete(_userId: string): Promise<void> {
    // Deprecated in V1 — see requestAccountDeletion.
    return Promise.reject(NOT_IMPL('delete', 'reserved for future admin-driven delete'));
  }

  /**
   * FR-SETTINGS-012 / FR-AUTH-016 — `request_account_deletion` deactivates the account for 30
   * days (the profile disappears for everyone else at once, push stops); `restore_account`
   * brings it back. The identity is read from the session.
   */
  async requestAccountDeletion(): Promise<void> {
    await mapRuleErrors(
      async () => unwrapCall('rpc:request_account_deletion', await this.client.rpc('request_account_deletion')),
      (reason, cause) => {
        if (reason === 'unauthenticated' || reason === 'suspended') {
          return new DeleteAccountError(reason, reason, cause);
        }
        return new DeleteAccountError('server_error', reason, cause);
      },
    );
  }

  // ── Follows ──────────────────────────────────────────────────────────────

  follow(followerId: string, followedId: string) {
    return followEdge(this.client, followerId, followedId);
  }
  unfollow(followerId: string, followedId: string): Promise<void> {
    return unfollowEdge(this.client, followerId, followedId);
  }
  isFollowing(followerId: string, followedId: string): Promise<boolean> {
    return isFollowingEdge(this.client, followerId, followedId);
  }
  getFollowers(userId: string, limit: number, cursor?: string) {
    return listFollowers(this.client, userId, limit, cursor);
  }
  getFollowing(userId: string, limit: number, cursor?: string) {
    return listFollowing(this.client, userId, limit, cursor);
  }
  sendFollowRequest(requesterId: string, targetId: string) {
    return sendRequest(this.client, requesterId, targetId);
  }
  cancelFollowRequest(requesterId: string, targetId: string): Promise<void> {
    return cancelRequest(this.client, requesterId, targetId);
  }
  acceptFollowRequest(requesterId: string, targetId: string): Promise<void> {
    return acceptRequest(this.client, requesterId, targetId);
  }
  rejectFollowRequest(requesterId: string, targetId: string): Promise<void> {
    return rejectRequest(this.client, requesterId, targetId);
  }
  getPendingFollowRequests(userId: string) {
    return listPendingRaw(this.client, userId);
  }
  getPendingFollowRequestsWithUsers(userId: string, limit: number, cursor?: string) {
    return listPendingWithUsers(this.client, userId, limit, cursor);
  }
  getFollowStateRaw(viewerId: string, targetUserId: string) {
    return fetchFollowStateRaw(this.client, viewerId, targetUserId);
  }

  searchUsers(query: string, opts: { excludeUserId: string; limit: number }): Promise<User[]> {
    return searchUsers(this.client, query, opts);
  }

  /** FR-NOTIF-014 — read, merge (`mergeNotificationPreferences`), write on the caller's `user_private`. */
  async updateNotificationPreferences(
    userId: string,
    partial: NotificationPreferencesPatch,
  ): Promise<NotificationPreferences> {
    const row = unwrapCall(
      'table:user_private',
      await this.client
        .from('user_private')
        .select('notification_preferences')
        .eq('user_id', userId)
        .maybeSingle(),
    );
    if (!row) throw new Error('updateNotificationPreferences: no user_private row');
    const stored = row.notification_preferences;
    const merged = mergeNotificationPreferences(
      stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? stored : {},
      partial,
    );
    await updateUserPrivate(this.client, userId, { notification_preferences: merged });
    return toNotificationPreferences(merged);
  }

  findByAuthIdentity(_provider: string, _subject: string): Promise<never> {
    return Promise.reject(NOT_IMPL('findByAuthIdentity', 'P0.4'));
  }
  createAuthIdentity(): Promise<never> {
    return Promise.reject(NOT_IMPL('createAuthIdentity', 'auto-created by handle_new_auth_user trigger'));
  }
}
