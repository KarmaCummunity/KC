/** FR-PROFILE-007: Edit Profile orchestrator. Validates inputs, then issues
 *  a single atomic `UPDATE users SET ...` (audit §3.5 — was Promise.all of
 *  four independent writes). Typed `ProfileError` codes per audit §3.6. */
import { BIOGRAPHY_MAX_LENGTH, STREET_NUMBER_PATTERN, containsBiographyUrl } from '@kc/domain';
import type { AuthProfileMetadataPatch, IAuthService } from '../ports/IAuthService';
import type { IUserRepository } from '../ports/IUserRepository';
import { assertSessionUser } from './assertSessionUser';
import { ProfileError } from './errors';

export interface UpdateProfileInput {
  readonly sessionUserId: string;
  readonly userId: string;
  readonly displayName?: string;
  readonly city?: string;
  readonly cityName?: string;
  /** When present, persists or clears (`{ street: null, streetNumber: null }`) profile address lines. */
  readonly profileAddress?: { readonly street: string | null; readonly streetNumber: string | null };
  /** When present, persists (trimmed) or clears (null) the non-verified contact phone (FR-PROFILE-007 AC1). */
  readonly contactPhone?: string | null;
  readonly biography?: string | null;
  readonly avatarUrl?: string | null;
}

export class UpdateProfileUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly auth: IAuthService,
  ) {}

  async execute(input: UpdateProfileInput): Promise<void> {
    assertSessionUser(input.sessionUserId, input.userId);
    if (!input.userId.trim()) throw new ProfileError('invalid_user_id');

    validateDisplayName(input.displayName);
    validateBiography(input.biography);
    validateCity(input.city, input.cityName);
    const address = normalizeProfileAddress(input.profileAddress);
    const contactPhone = normalizeContactPhone(input.contactPhone);

    const patch = buildPatch(input, address, contactPhone);
    if (Object.keys(patch).length === 0) throw new ProfileError('empty_patch');
    await this.users.updateEditableProfile(input.userId, patch);
    const metaPatch = toAuthMetadataPatch(patch);
    if (metaPatch) await this.auth.syncProfileMetadata(metaPatch);
  }
}

type ProfilePatch = Parameters<IUserRepository['updateEditableProfile']>[1];
type NormalizedAddress = { street: string | null; streetNumber: string | null } | undefined;

function validateDisplayName(displayName: string | undefined): void {
  if (displayName === undefined) return;
  const name = displayName.trim();
  if (name.length === 0 || name.length > 50) throw new ProfileError('invalid_display_name');
}

function validateBiography(biography: string | null | undefined): void {
  if (biography === undefined || biography === null) return;
  if (biography.length > BIOGRAPHY_MAX_LENGTH) throw new ProfileError('biography_too_long');
  if (containsBiographyUrl(biography)) throw new ProfileError('biography_url_forbidden');
}

function validateCity(city: string | undefined, cityName: string | undefined): void {
  if ((city === undefined) !== (cityName === undefined)) {
    throw new ProfileError('city_pair_required');
  }
  if (city !== undefined && city.trim().length === 0) throw new ProfileError('invalid_city');
}

function normalizeProfileAddress(address: UpdateProfileInput['profileAddress']): NormalizedAddress {
  if (address === undefined) return undefined;
  const { street, streetNumber } = address;
  if (street === null && streetNumber === null) return { street: null, streetNumber: null };
  const s = street?.trim();
  const n = streetNumber?.trim();
  if (!s || !n) throw new ProfileError('incomplete_profile_address');
  if (s.length > 80) throw new ProfileError('invalid_profile_street');
  if (!STREET_NUMBER_PATTERN.test(n)) throw new ProfileError('invalid_profile_street_number');
  return { street: s, streetNumber: n };
}

function normalizeContactPhone(phone: string | null | undefined): string | null | undefined {
  if (phone === undefined) return undefined;
  const trimmed = phone?.trim() ?? '';
  if (trimmed.length === 0) return null;
  if (trimmed.length > 20) throw new ProfileError('invalid_contact_phone');
  return trimmed;
}

function buildPatch(
  input: UpdateProfileInput,
  address: NormalizedAddress,
  contactPhone: string | null | undefined,
): ProfilePatch {
  const patch: ProfilePatch = {};
  if (input.displayName !== undefined) patch.displayName = input.displayName.trim();
  if (input.city !== undefined) patch.city = input.city;
  if (input.cityName !== undefined) patch.cityName = input.cityName;
  if (address !== undefined) {
    patch.profileStreet = address.street;
    patch.profileStreetNumber = address.streetNumber;
  }
  if (contactPhone !== undefined) patch.contactPhone = contactPhone;
  if (input.biography !== undefined) patch.biography = input.biography;
  if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl;
  return patch;
}

function toAuthMetadataPatch(
  patch: ProfilePatch,
): AuthProfileMetadataPatch | null {
  if (patch.displayName === undefined && patch.avatarUrl === undefined) return null;
  return {
    ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
    ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
  };
}
