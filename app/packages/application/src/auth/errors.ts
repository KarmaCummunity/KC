// ─────────────────────────────────────────────
// Auth domain errors
// Mapped to SRS: FR-AUTH-006, FR-AUTH-007, FR-AUTH-013, FR-AUTH-017
// ─────────────────────────────────────────────

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_already_in_use'
  | 'authentication_failed'
  | 'weak_password'
  | 'invalid_email'
  | 'email_not_verified'
  | 'session_expired'
  | 'rate_limited'
  | 'cooldown_active'
  | 'network'
  | 'forbidden'
  | 'unknown';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly cause?: unknown;

  constructor(code: AuthErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.cause = cause;
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError;
}

// ─────────────────────────────────────────────
// Delete-account domain error
// Mapped to SRS: FR-SETTINGS-012 V1
// ─────────────────────────────────────────────

export type DeleteAccountErrorCode =
  | 'unauthenticated'
  | 'suspended'
  | 'auth_delete_failed'
  | 'network'
  | 'server_error';

export class DeleteAccountError extends Error {
  readonly code: DeleteAccountErrorCode;
  readonly cause?: unknown;

  constructor(code: DeleteAccountErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'DeleteAccountError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, DeleteAccountError.prototype);
  }
}

export function isDeleteAccountError(value: unknown): value is DeleteAccountError {
  return value instanceof DeleteAccountError;
}

// ─────────────────────────────────────────────
// Onboarding state-machine error
// Audit 2026-05-10 §17.3 — illegal transitions on users.onboarding_state.
// Mapped to SRS: FR-AUTH-010, FR-AUTH-012.
// ─────────────────────────────────────────────

export type OnboardingErrorCode =
  | 'illegal_transition';

export class OnboardingError extends Error {
  readonly code: OnboardingErrorCode;
  readonly cause?: unknown;

  constructor(code: OnboardingErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'OnboardingError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, OnboardingError.prototype);
  }
}

export function isOnboardingError(value: unknown): value is OnboardingError {
  return value instanceof OnboardingError;
}

// ─────────────────────────────────────────────
// Edit-profile domain error
// Audit 2026-05-10 §3.6 — replaces raw `Error('invalid_display_name')`
// throws in UpdateProfileUseCase / CompleteBasicInfoUseCase.
// Mapped to SRS: FR-PROFILE-007.
// ─────────────────────────────────────────────

export type ProfileErrorCode =
  | 'invalid_user_id'
  | 'invalid_display_name'
  | 'invalid_avatar_url'
  | 'biography_too_long'
  | 'biography_url_forbidden'
  | 'city_pair_required'
  | 'invalid_city'
  | 'incomplete_profile_address'
  | 'invalid_profile_street'
  | 'invalid_profile_street_number'
  | 'invalid_contact_phone'
  | 'invalid_date_of_birth'
  | 'underage'
  | 'empty_patch';

export class ProfileError extends Error {
  readonly code: ProfileErrorCode;
  readonly cause?: unknown;

  constructor(code: ProfileErrorCode, message?: string, cause?: unknown) {
    super(message ?? code);
    this.name = 'ProfileError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, ProfileError.prototype);
  }
}

export function isProfileError(value: unknown): value is ProfileError {
  return value instanceof ProfileError;
}
