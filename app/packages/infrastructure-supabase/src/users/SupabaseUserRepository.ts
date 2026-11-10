// ─────────────────────────────────────────────
// SupabaseUserRepository — adapter for IUserRepository.
// Slice A (P0.3): only onboarding read/write methods are wired. The remaining
// methods throw `not_implemented` and will be filled in by P0.4 / P1.1 / P2.4.
// docs/spec/requirements/01_auth_and_onboarding.md
// ─────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IUserRepository, NotificationPreferencesPatch, OnboardingBootstrap } from '@kc/application';
import { DeleteAccountError } from '@kc/application';
import type { NotificationPreferences, OnboardingState, User } from '@kc/domain';
import {
  supabaseClearBasicInfoSkipped,
  supabaseGetOnboardingBootstrap,
  supabaseMarkBasicInfoSkipped,
  supabaseResetOnboardingForDev,
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
import { mapUserRow, type UserRow } from './mapUserRow';
import { fetchUserBy } from './fetchUserBy';
import { getChatCounterpartyContact } from './getChatCounterpartyContact';
import { searchUsers } from './searchUsers';
import { USER_PUBLIC_SELECT_COLUMNS } from './userPublicColumns';
import {
  fetchUsersSelfPrivateFields,
  mergeSelfPrivateFields,
} from './usersSelfPrivateFields';
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

const NOT_IMPL = (name: string, slice: string) =>
  new Error(`SupabaseUserRepository.${name}: not_implemented (${slice})`);

export class SupabaseUserRepository implements IUserRepository {
  constructor(private readonly client: SupabaseClient) {}

  // ── Onboarding (P0.3 slice A) ────────────────────────────────────────────

  getOnboardingBootstrap(userId: string): Promise<OnboardingBootstrap> {
    return supabaseGetOnboardingBootstrap(this.client, userId);
  }

  markBasicInfoSkipped(userId: string): Promise<void> {
    return supabaseMarkBasicInfoSkipped(this.client, userId);
  }

  clearBasicInfoSkipped(userId: string): Promise<void> {
    return supabaseClearBasicInfoSkipped(this.client, userId);
  }

  setBasicInfo(
    userId: string,
    params: { displayName: string; city: string; cityName: string },
  ): Promise<void> {
    return supabaseSetBasicInfo(this.client, userId, params);
  }

  setOnboardingState(state: OnboardingState): Promise<void> {
    return supabaseSetOnboardingState(this.client, state);
  }

  resetOnboardingForDev(): Promise<void> {
    return supabaseResetOnboardingForDev(this.client);
  }

  async setAvatar(userId: string, avatarUrl: string | null): Promise<void> {
    const { error } = await this.client
      .from('users')
      .update({ avatar_url: avatarUrl })
      .eq('user_id', userId);
    if (error) throw new Error(`setAvatar: ${error.message}`);
  }

  async setBiography(userId: string, biography: string | null): Promise<void> {
    const { error } = await this.client
      .from('users')
      .update({ biography })
      .eq('user_id', userId);
    if (error) throw new Error(`setBiography: ${error.message}`);
  }

  async setPrivacyMode(userId: string, mode: import('@kc/domain').PrivacyMode): Promise<User> {
    const { data, error } = await this.client
      .from('users')
      .update({ privacy_mode: mode, privacy_changed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select(USER_PUBLIC_SELECT_COLUMNS)
      .single();
    if (error) throw new Error(`setPrivacyMode: ${error.message}`);
    let user = mapUserRow(data as unknown as UserRow);
    const slice = await fetchUsersSelfPrivateFields(this.client);
    if (slice) user = mergeSelfPrivateFields(user, slice);
    return user;
  }

  /** FR-CLOSURE-004 AC3 — flips users.closure_explainer_dismissed = true. */
  async dismissClosureExplainer(userId: string): Promise<void> {
    const { error } = await this.client
      .from('users')
      .update({ closure_explainer_dismissed: true })
      .eq('user_id', userId);
    if (error) throw new Error(`dismissClosureExplainer: ${error.message}`);
  }

  /** FR-FEED-015 AC3 — flips users.first_post_nudge_dismissed = true. */
  async dismissFirstPostNudge(userId: string): Promise<void> {
    const { error } = await this.client
      .from('users')
      .update({ first_post_nudge_dismissed: true })
      .eq('user_id', userId);
    if (error) throw new Error(`dismissFirstPostNudge: ${error.message}`);
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

  // ── Methods deferred to later slices ─────────────────────────────────────

  async findById(userId: string): Promise<User | null> {
    return fetchUserBy(this.client, 'user_id', userId);
  }
  async findByHandle(handle: string): Promise<User | null> {
    return fetchUserBy(this.client, 'share_handle', handle);
  }

  /** FR-CHAT-014 AC7 — counterpart contact_phone when viewer is a chat participant. */
  getChatCounterpartyContact(chatId: string): Promise<string | null> {
    return getChatCounterpartyContact(this.client, chatId);
  }
  create(): Promise<never> {
    return Promise.reject(NOT_IMPL('create', 'auto-created by handle_new_user trigger'));
  }
  update(): Promise<never> {
    return Promise.reject(NOT_IMPL('update', 'P2.4'));
  }
  delete(_userId: string): Promise<void> {
    // Deprecated in V1 — see deleteAccountViaEdgeFunction.
    return Promise.reject(NOT_IMPL('delete', 'reserved for future admin-driven delete'));
  }

  async deleteAccountViaEdgeFunction(): Promise<void> {
    const { data, error } = await this.client.functions.invoke<{
      ok: boolean;
      error?: 'unauthenticated' | 'suspended' | 'auth_delete_failed' | 'db_failed';
      counts?: { posts: number; chats_anonymized: number; chats_dropped: number };
    }>('delete-account', { method: 'POST' });

    if (error) {
      // FunctionsHttpError: error.context is the raw Response (data is null on
      // non-2xx, so we must parse the body ourselves to recover the typed
      // error code). FunctionsFetchError: error.context is undefined → network.
      const ctx = (error as { context?: Response }).context;
      const status = ctx?.status;
      if (status == null) throw new DeleteAccountError('network', error.message, error);
      if (status === 401) throw new DeleteAccountError('unauthenticated', 'no valid session', error);
      if (status === 403) throw new DeleteAccountError('suspended', 'account is suspended', error);
      // Read the body for the auth_delete_failed signal (critical zombie state).
      let body: { error?: string } | null;
      try {
        body = await ctx!.clone().json();
      } catch {
        body = null;
      }
      if (status === 500 && body?.error === 'auth_delete_failed') {
        throw new DeleteAccountError('auth_delete_failed', 'DB cleaned but auth survived', error);
      }
      throw new DeleteAccountError('server_error', error.message, error);
    }
    if (data?.ok === true) return;
    if (data?.error === 'auth_delete_failed') {
      throw new DeleteAccountError('auth_delete_failed', 'DB cleaned but auth survived');
    }
    throw new DeleteAccountError('server_error', `unexpected response: ${JSON.stringify(data)}`);
  }
  async follow(followerId: string, followedId: string) {
    return followEdge(this.client, followerId, followedId);
  }
  async unfollow(followerId: string, followedId: string): Promise<void> {
    return unfollowEdge(this.client, followerId, followedId);
  }
  async isFollowing(followerId: string, followedId: string): Promise<boolean> {
    return isFollowingEdge(this.client, followerId, followedId);
  }
  async getFollowers(userId: string, limit: number, cursor?: string) {
    return listFollowers(this.client, userId, limit, cursor);
  }
  async getFollowing(userId: string, limit: number, cursor?: string) {
    return listFollowing(this.client, userId, limit, cursor);
  }
  async sendFollowRequest(requesterId: string, targetId: string) {
    return sendRequest(this.client, requesterId, targetId);
  }
  async cancelFollowRequest(requesterId: string, targetId: string): Promise<void> {
    return cancelRequest(this.client, requesterId, targetId);
  }
  async acceptFollowRequest(requesterId: string, targetId: string): Promise<void> {
    return acceptRequest(this.client, requesterId, targetId);
  }
  async rejectFollowRequest(requesterId: string, targetId: string): Promise<void> {
    return rejectRequest(this.client, requesterId, targetId);
  }
  async getPendingFollowRequests(userId: string) {
    return listPendingRaw(this.client, userId);
  }
  async getPendingFollowRequestsWithUsers(userId: string, limit: number, cursor?: string) {
    return listPendingWithUsers(this.client, userId, limit, cursor);
  }
  async getFollowStateRaw(viewerId: string, targetUserId: string) {
    return fetchFollowStateRaw(this.client, viewerId, targetUserId);
  }

  searchUsers(
    query: string,
    opts: { excludeUserId: string; limit: number },
  ): Promise<User[]> {
    return searchUsers(this.client, query, opts);
  }

  async updateNotificationPreferences(
    userId: string,
    partial: NotificationPreferencesPatch,
  ): Promise<NotificationPreferences> {
    const merge: Record<string, unknown> = {};
    if (partial.critical !== undefined) merge.critical = partial.critical;
    if (partial.social !== undefined) merge.social = partial.social;
    if (partial.quietHours !== undefined) merge.quietHours = partial.quietHours;
    // The RPC merges `kinds` per key (0460), so only the toggled kinds are sent.
    if (partial.kinds !== undefined) merge.kinds = partial.kinds;
    const { data, error } = await this.client.rpc(
      'users_merge_notification_preferences',
      { p_user_id: userId, p_merge: merge },
    );
    if (error) throw new Error(`updateNotificationPreferences: ${error.message}`);
    return data as NotificationPreferences;
  }

  findByAuthIdentity(_provider: string, _subject: string): Promise<never> {
    return Promise.reject(NOT_IMPL('findByAuthIdentity', 'P0.4'));
  }
  createAuthIdentity(): Promise<never> {
    return Promise.reject(NOT_IMPL('createAuthIdentity', 'auto-created by handle_new_user trigger'));
  }
}
