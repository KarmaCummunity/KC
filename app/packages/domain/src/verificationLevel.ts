// FR-VERIFY-001 / FR-VERIFY-012 — member verification levels.
// The server (`user_verification_level`, migration 0637) is the source of truth for every
// member; this mirror lets the owner's own UI react to an edit before the refetch lands.

/** 0 none · 1 complete profile · 2 ID verified · 3 recognised organization. */
export type VerificationLevel = 0 | 1 | 2 | 3;

/** Profile fields that must all be non-blank for level 1 (FR-VERIFY-012 AC1). */
export interface CompleteProfileFields {
  readonly displayName: string | null;
  readonly city: string | null;
  readonly dateOfBirth: string | null;
  readonly avatarUrl: string | null;
  readonly profileStreet: string | null;
  readonly profileStreetNumber: string | null;
  readonly contactPhone: string | null;
}

export type CompleteProfileField = keyof CompleteProfileFields;

const COMPLETE_PROFILE_FIELDS: readonly CompleteProfileField[] = [
  'displayName',
  'city',
  'dateOfBirth',
  'avatarUrl',
  'profileStreet',
  'profileStreetNumber',
  'contactPhone',
];

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

/** Fields still missing for level 1, in display order. Empty = complete. */
export function missingCompleteProfileFields(fields: CompleteProfileFields): CompleteProfileField[] {
  return COMPLETE_PROFILE_FIELDS.filter((key) => isBlank(fields[key]));
}

export function isProfileComplete(fields: CompleteProfileFields): boolean {
  return missingCompleteProfileFields(fields).length === 0;
}

/** Badge level for UI: trust the server, but show level 1 while a profile-complete row waits for trigger/refetch. */
export function effectiveVerificationLevel(
  user: CompleteProfileFields & { readonly verificationLevel: VerificationLevel },
): VerificationLevel {
  if (user.verificationLevel > 0) return user.verificationLevel;
  return isProfileComplete(user) ? 1 : 0;
}

/** Narrows an untrusted wire value (e.g. a DB smallint) to a level; anything else is 0. */
export function toVerificationLevel(value: unknown): VerificationLevel {
  return value === 1 || value === 2 || value === 3 ? value : 0;
}
