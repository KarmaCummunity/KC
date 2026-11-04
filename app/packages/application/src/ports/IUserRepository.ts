import type {
  User,
  AuthIdentity,
  FollowEdge,
  FollowRequest,
  OnboardingState,
  AccountStatus,
  NotificationPreferences,
} from '@kc/domain';

// ── IUserRepository ───────────────────────────
// Port (interface) for user persistence.
// Implementations live in infrastructure-supabase.

/** FR-AUTH-007 AC2 + FR-AUTH-010 — post-auth cold-start routing inputs. */
export interface OnboardingBootstrap {
  readonly state: OnboardingState;
  /** True after the user used Skip on step 1; client routes to feed, not the wizard. */
  readonly basicInfoSkipped: boolean;
}

/**
 * FR-NOTIF-014 / FR-NOTIF-017 — partial preference update. Top-level keys replace the stored
 * value; `kinds` is merged per key so toggling one notification type keeps the others.
 */
export type NotificationPreferencesPatch = Partial<
  Pick<NotificationPreferences, 'critical' | 'social' | 'quietHours' | 'kinds'>
>;

/** Raw signals from DB used to derive FR-FOLLOW-011 state. */
export interface FollowStateRaw {
  /** target.privacy_mode + target.account_status. null if target not visible / does not exist. */
  target: { userId: string; privacyMode: 'Public' | 'Private'; accountStatus: AccountStatus } | null;
  followingExists: boolean;
  pendingRequestExists: boolean;
  cooldownUntil: string | null;
}

export interface IUserRepository {
  findById(userId: string): Promise<User | null>;
  findByHandle(handle: string): Promise<User | null>;
  /** FR-CHAT-014 AC7 — counterpart `contact_phone` for an active chat participant only. */
  getChatCounterpartyContact(chatId: string): Promise<string | null>;
  create(user: Omit<User, 'createdAt' | 'updatedAt'>): Promise<User>;
  update(userId: string, patch: Partial<User>): Promise<User>;
  /**
   * @deprecated V1 uses `deleteAccountViaEdgeFunction()` (no arg, identity from JWT).
   * The original arg-taking shape was a stub; keep the method on the port for
   * potential future admin-driven delete (mirrors IPostRepository.delete vs adminRemove).
   */
  delete(userId: string): Promise<void>;

  /**
   * FR-SETTINGS-012 V1 — Self-delete the currently authenticated user. Identity
   * is read from the JWT server-side; no client-supplied userId. Throws
   * `DeleteAccountError` with one of the documented codes:
   * - `unauthenticated` — no valid session
   * - `suspended` — account_status blocks self-deletion
   * - `auth_delete_failed` — DB is already cleaned but auth.users survived
   * - `network` / `server_error` — generic failures
   */
  deleteAccountViaEdgeFunction(): Promise<void>;

  // ── Onboarding (P0.3) ─────────────────────────
  /** FR-AUTH-007 AC2: read onboarding_state + basic_info_skipped for cold-start routing. */
  getOnboardingBootstrap(userId: string): Promise<OnboardingBootstrap>;

  /** FR-AUTH-010 AC3: user skipped step 1 — persist so the full wizard does not reopen on relaunch. */
  markBasicInfoSkipped(userId: string): Promise<void>;

  /** Clear the skip flag (e.g. dev reset onboarding, or after saving real basic info in setBasicInfo). */
  clearBasicInfoSkipped(userId: string): Promise<void>;

  /** FR-AUTH-010: persist step-1 fields. `cityName` must mirror the matching `cities.name_he` row. */
  setBasicInfo(
    userId: string,
    params: { displayName: string; city: string; cityName: string },
  ): Promise<void>;

  /** FR-AUTH-010 AC3 / FR-AUTH-012 AC3: advance the onboarding state machine. */
  setOnboardingState(userId: string, state: OnboardingState): Promise<void>;

  /**
   * FR-AUTH-011 AC4 + AC5: persist the user's profile photo URL.
   * Pass `null` to clear an SSO-prefilled or previously-uploaded avatar (FR-PROFILE-007 also calls this).
   */
  setAvatar(userId: string, avatarUrl: string | null): Promise<void>;

  /**
   * FR-PROFILE-007 AC1: persist a user's biography. Pass `null` to clear it.
   * Caller is expected to enforce ≤ 200 chars + URL-filter validation upstream;
   * the DB still applies the length CHECK as defence in depth.
   */
  setBiography(userId: string, biography: string | null): Promise<void>;

  /**
   * FR-PROFILE-005, 006 — flips users.privacy_mode and stamps privacy_changed_at.
   * Returns the updated User. Idempotent at the DB layer; the use case prevents
   * pointless writes when the mode is unchanged.
   */
  setPrivacyMode(userId: string, mode: import('@kc/domain').PrivacyMode): Promise<User>;

  /**
   * FR-PROFILE-007: read the editable fields for the Edit Profile form.
   * Avoids needing the full `findById` (which depends on follower / counter
   * mappings deferred to P2.4). Throws if the row is missing.
   */
  getEditableProfile(userId: string): Promise<{
    displayName: string | null;
    city: string | null;
    cityName: string | null;
    profileStreet: string | null;
    profileStreetNumber: string | null;
    contactPhone: string | null;
    biography: string | null;
    avatarUrl: string | null;
  }>;

  /**
   * FR-PROFILE-007 — optional street + number on the user profile (null,null clears).
   * Same length / number shape as post addresses when non-null.
   */
  setProfileAddressLines(
    userId: string,
    street: string | null,
    streetNumber: string | null,
  ): Promise<void>;

  /**
   * FR-AUTH-010 AC2.c / FR-PROFILE-007 AC1 — optional contact phone (null clears).
   * Free-form 1–20 chars after trim. Non-verified; caller validates upstream and
   * DB CHECK is defence in depth.
   */
  setContactPhone(userId: string, contactPhone: string | null): Promise<void>;

  /**
   * FR-AUTH-010 AC2.d — stores the caller's private date of birth (ISO `YYYY-MM-DD`) through
   * `rpc_set_date_of_birth`, which re-checks the 18+ rule on the server. Throws `ProfileError`
   * with `invalid_date_of_birth` or `underage` when the server rejects it.
   */
  setDateOfBirth(isoDate: string): Promise<void>;

  /**
   * FR-PROFILE-007 — atomic multi-field edit (audit §3.5). All present fields
   * land in one `UPDATE users SET ...` statement, so a transport-layer failure
   * never leaves the user with a half-applied edit (e.g. new name + old city).
   * Undefined fields are not written; null fields clear nullable columns
   * (biography, avatar_url, profile_street, profile_street_number, contact_phone).
   */
  updateEditableProfile(
    userId: string,
    patch: {
      displayName?: string;
      city?: string;
      cityName?: string;
      profileStreet?: string | null;
      profileStreetNumber?: string | null;
      contactPhone?: string | null;
      biography?: string | null;
      avatarUrl?: string | null;
    },
  ): Promise<void>;

  /** FR-CLOSURE-004 AC3 — flips users.closure_explainer_dismissed = true. Idempotent. */
  dismissClosureExplainer(userId: string): Promise<void>;

  /** FR-FEED-015 AC3 — flips users.first_post_nudge_dismissed = true. Idempotent. */
  dismissFirstPostNudge(userId: string): Promise<void>;

  /**
   * Lightweight user search by display name or share handle (case-insensitive
   * substring). Used by the closure flow's "pick from any user" mode (option 4)
   * when the recipient isn't in the owner's chat list. Excludes the caller
   * themselves.
   */
  searchUsers(query: string, opts: { excludeUserId: string; limit: number }): Promise<User[]>;

  // Follows
  follow(followerId: string, followedId: string): Promise<FollowEdge>;
  unfollow(followerId: string, followedId: string): Promise<void>;
  isFollowing(followerId: string, followedId: string): Promise<boolean>;
  getFollowers(userId: string, limit: number, cursor?: string): Promise<User[]>;
  getFollowing(userId: string, limit: number, cursor?: string): Promise<User[]>;

  // Follow requests (private profiles)
  sendFollowRequest(requesterId: string, targetId: string): Promise<FollowRequest>;
  acceptFollowRequest(requesterId: string, targetId: string): Promise<void>;
  rejectFollowRequest(requesterId: string, targetId: string): Promise<void>;
  cancelFollowRequest(requesterId: string, targetId: string): Promise<void>;
  getPendingFollowRequests(userId: string): Promise<FollowRequest[]>;

  /**
   * FR-FOLLOW-007 AC2 — pending requests joined with the requester's User row.
   * Used to render avatar+name+city without a second round-trip per row.
   */
  getPendingFollowRequestsWithUsers(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<import('../follow/types').PaginatedRequests>;

  /**
   * FR-FOLLOW-011 — single round-trip probe. Returns raw signals the
   * GetFollowStateUseCase needs to derive a FollowState. Avoids 4 separate
   * round-trips on every profile load.
   */
  getFollowStateRaw(viewerId: string, targetUserId: string): Promise<FollowStateRaw>;

  /**
   * Atomically merges notification preferences. Partial fields only update the
   * named keys; unspecified keys are preserved.
   * Mapped to: FR-NOTIF-014.
   */
  updateNotificationPreferences(
    userId: string,
    partial: NotificationPreferencesPatch,
  ): Promise<NotificationPreferences>;

  // Auth identities
  findByAuthIdentity(provider: string, subject: string): Promise<User | null>;
  createAuthIdentity(identity: Omit<AuthIdentity, 'createdAt'>): Promise<AuthIdentity>;
}
