// InMemoryProfileEditing — the in-memory implementation of the profile-editing
// slice of IUserRepository, held to the shared contract
// (contracts/profileEditing.contract.ts) on every `pnpm test`.
//
// It models what public.users enforces for a signed-in member:
// - the column CHECKs (0001 biography length, 0073 biography links, 0084 display
//   name, 0096 contact phone, 0081 street pair and number pattern);
// - the city foreign key to public.cities;
// - users_update_self, under which a write to another member's row matches no
//   row and resolves without effect;
// - user_private_select_self, which shows the phone and address only to their owner;
// - set_onboarding_state, which moves the actor's onboarding along
//   `onboardingMachine` and leaves step 1 only with name, city and date of birth.
// Every write validates the whole next row before storing it, so a refused write
// changes nothing, like the single UPDATE statement it stands for (the adapter issues
// one statement per table; the fake keeps the all-or-nothing reading of the contract).

import { STREET_NUMBER_PATTERN, canTransition, onboardingMachine, type OnboardingState } from '@kc/domain';
import { PROFILE_FIELD_LIMITS, type ProfileCity, type ProfileEditing } from '../../contracts';
import { OnboardingError } from '../errors';

type EditableProfile = Awaited<ReturnType<ProfileEditing['getEditableProfile']>>;
type ProfilePatch = Parameters<ProfileEditing['updateEditableProfile']>[1];

interface ProfileRow extends EditableProfile {
  onboardingState: OnboardingState;
  basicInfoSkipped: boolean;
  dateOfBirth: string | null;
}

/** The step-1 fields `set_onboarding_state` requires before a member leaves step 1. */
function hasBasicInfo(row: ProfileRow): boolean {
  return Boolean(row.displayName?.trim()) && Boolean(row.city?.trim()) && row.dateOfBirth !== null;
}

/** users_biography_no_url_check (0073); `\p{L}` stands in for Postgres's Unicode `\w`. */
const BIOGRAPHY_LINK_PATTERN = /(https?:\/\/|www\.|[\p{L}\p{N}_.-]+\.[a-z]{2,})/iu;

/** The CHECK constraint a row breaks, or null when the row is valid. */
function violatedCheck(row: ProfileRow, cityIds: ReadonlySet<string>): string | null {
  const { displayNameMax, biographyMax, contactPhoneMax, streetMax } = PROFILE_FIELD_LIMITS;
  const name = row.displayName;
  if (name !== null && (name.length < 1 || name.length > displayNameMax)) return 'users_display_name_check';
  const bio = row.biography;
  if (bio !== null && bio.length > biographyMax) return 'users_biography_check';
  if (bio !== null && BIOGRAPHY_LINK_PATTERN.test(bio)) return 'users_biography_no_url_check';
  const phone = row.contactPhone?.trim();
  if (phone !== undefined && (phone.length < 1 || phone.length > contactPhoneMax)) return 'users_contact_phone_chk';
  const street = row.profileStreet;
  const streetNumber = row.profileStreetNumber;
  const bothEmpty = street === null && streetNumber === null;
  const validPair =
    street !== null &&
    streetNumber !== null &&
    street.length >= 1 &&
    street.length <= streetMax &&
    STREET_NUMBER_PATTERN.test(streetNumber);
  if (!bothEmpty && !validPair) return 'users_profile_address_pair_chk';
  if (row.city !== null && !cityIds.has(row.city)) return 'users_city_fkey';
  return null;
}

/** The rows of every member plus the city list, shared by all actors of a test. */
export class InMemoryProfileStore {
  readonly rows = new Map<string, ProfileRow>();
  private readonly cityIds: ReadonlySet<string>;
  private readonly cityNames: ReadonlyMap<string, string>;
  private seq = 0;

  constructor(cities: readonly ProfileCity[]) {
    this.cityIds = new Set(cities.map((city) => city.id));
    this.cityNames = new Map(cities.map((city) => [city.id, city.name]));
  }

  /** A new member as the signup trigger leaves them: named, in the first city, at step 1. */
  addMember(city: ProfileCity): { userId: string } {
    this.seq += 1;
    const userId = `member-${this.seq}`;
    this.rows.set(userId, {
      displayName: `member ${this.seq}`,
      city: city.id,
      cityName: city.name,
      profileStreet: null,
      profileStreetNumber: null,
      contactPhone: null,
      biography: null,
      avatarUrl: null,
      onboardingState: 'pending_basic_info',
      basicInfoSkipped: false,
      dateOfBirth: null,
    });
    return { userId };
  }

  /** Validates and stores `next`; throws like the failed UPDATE, leaving the row untouched. */
  write(userId: string, next: ProfileRow): void {
    const check = violatedCheck(next, this.cityIds);
    if (check) throw new Error(`update users: violates ${check}`);
    // The city name is not stored: it is the name of the `cities` row of `city`.
    this.rows.set(userId, { ...next, cityName: next.city === null ? null : (this.cityNames.get(next.city) ?? null) });
  }
}

/** The profile-editing slice as seen by one signed-in member. */
export class InMemoryProfileEditing implements ProfileEditing {
  constructor(
    private readonly store: InMemoryProfileStore,
    private readonly actorId: string,
  ) {}

  /** users_update_self: a write applies to the actor's own row only, else matches nothing. */
  private update(userId: string, change: Partial<ProfileRow>): void {
    const row = this.store.rows.get(userId);
    if (!row || userId !== this.actorId) return;
    this.store.write(userId, { ...row, ...change });
  }

  async getEditableProfile(userId: string): Promise<EditableProfile> {
    const row = this.store.rows.get(userId);
    if (!row) throw new Error('getEditableProfile: no row');
    const own = userId === this.actorId;
    return {
      displayName: row.displayName,
      city: row.city,
      cityName: row.cityName,
      profileStreet: own ? row.profileStreet : null,
      profileStreetNumber: own ? row.profileStreetNumber : null,
      contactPhone: own ? row.contactPhone : null,
      biography: row.biography,
      avatarUrl: row.avatarUrl,
    };
  }

  async updateEditableProfile(userId: string, patch: ProfilePatch): Promise<void> {
    // Undefined keys are dropped so they keep the stored value, as in the adapter.
    const defined = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (defined.length === 0) return;
    this.update(userId, Object.fromEntries(defined) as Partial<ProfileRow>);
  }

  async setAvatar(userId: string, avatarUrl: string | null): Promise<void> {
    this.update(userId, { avatarUrl });
  }

  async setBiography(userId: string, biography: string | null): Promise<void> {
    this.update(userId, { biography });
  }

  async setContactPhone(userId: string, contactPhone: string | null): Promise<void> {
    this.update(userId, { contactPhone });
  }

  async setProfileAddressLines(userId: string, street: string | null, streetNumber: string | null): Promise<void> {
    this.update(userId, { profileStreet: street, profileStreetNumber: streetNumber });
  }

  async getOnboardingBootstrap(userId: string) {
    const row = this.store.rows.get(userId);
    if (!row) throw new Error('getOnboardingBootstrap: no row');
    return { state: row.onboardingState, basicInfoSkipped: row.basicInfoSkipped };
  }

  async markBasicInfoSkipped(userId: string): Promise<void> {
    this.update(userId, { basicInfoSkipped: true });
  }

  async clearBasicInfoSkipped(userId: string): Promise<void> {
    this.update(userId, { basicInfoSkipped: false });
  }

  async setBasicInfo(userId: string, params: { displayName: string; city: string }): Promise<void> {
    this.update(userId, { ...params, basicInfoSkipped: false });
  }

  /** set_date_of_birth acts on the actor; its 18+ rule is pinned by SetDateOfBirthUseCase tests. */
  async setDateOfBirth(isoDate: string): Promise<void> {
    this.update(this.actorId, { dateOfBirth: isoDate });
  }

  /** set_onboarding_state: the step-1 rule first, then the graph, as the RPC and its trigger. */
  async setOnboardingState(onboardingState: OnboardingState): Promise<void> {
    const row = this.store.rows.get(this.actorId);
    if (!row) throw new Error('set_onboarding_state: user_not_found');
    const from = row.onboardingState;
    if (from === 'pending_basic_info' && onboardingState !== from && !hasBasicInfo(row)) {
      throw new OnboardingError('basic_info_missing', 'onboarding_basic_info_missing');
    }
    if (!canTransition(onboardingMachine, from, onboardingState).ok) {
      throw new OnboardingError('illegal_transition', `onboarding_transition_invalid: ${from} -> ${onboardingState}`);
    }
    this.update(this.actorId, { onboardingState });
  }
}
