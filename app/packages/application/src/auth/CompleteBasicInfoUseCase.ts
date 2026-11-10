/** FR-AUTH-010: Validate display_name + city; optional profile street/number (FR-PROFILE-007 shape);
 *  advance onboarding_state pending_basic_info → pending_avatar.
 *  City id+name come from the caller (CityPicker); DB FK is the final guard. */
import { STREET_NUMBER_PATTERN, dateOfBirthIssue } from '@kc/domain';
import type { IAuthService } from '../ports/IAuthService';
import type { IUserRepository } from '../ports/IUserRepository';
import { assertSessionUser } from './assertSessionUser';
import { OnboardingError, ProfileError } from './errors';

export interface CompleteBasicInfoInput {
  readonly sessionUserId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly cityId: string;
  readonly cityName: string;
  /** Required, ISO `YYYY-MM-DD`, at least 18 years old (FR-AUTH-010 AC2.d). */
  readonly dateOfBirth: string;
  /** Optional; both trimmed non-empty required to persist (same rules as UpdateProfileUseCase). */
  readonly profileStreet?: string;
  readonly profileStreetNumber?: string;
  /** Optional; trimmed value 1–20 chars persists, empty clears. Non-verified (FR-AUTH-010 AC2.c). */
  readonly contactPhone?: string;
}

export class CompleteBasicInfoUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly auth: IAuthService,
    /** Injected so the 18+ check is testable on any date. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: CompleteBasicInfoInput): Promise<void> {
    assertSessionUser(input.sessionUserId, input.userId);
    const trimmedName = input.displayName.trim();
    if (trimmedName.length === 0 || trimmedName.length > 50) {
      throw new ProfileError('invalid_display_name');
    }
    const trimmedCityId = input.cityId.trim();
    const trimmedCityName = input.cityName.trim();
    if (trimmedCityId.length === 0 || trimmedCityName.length === 0) {
      throw new ProfileError('invalid_city');
    }

    const dobIssue = dateOfBirthIssue(input.dateOfBirth, this.now());
    if (dobIssue) throw new ProfileError(dobIssue);

    const st = (input.profileStreet ?? '').trim();
    const num = (input.profileStreetNumber ?? '').trim();
    if (st.length > 0 !== num.length > 0) {
      throw new ProfileError('incomplete_profile_address');
    }
    if (st.length > 0) {
      if (st.length < 1 || st.length > 80) throw new ProfileError('invalid_profile_street');
      if (!STREET_NUMBER_PATTERN.test(num)) throw new ProfileError('invalid_profile_street_number');
    }

    const phone = (input.contactPhone ?? '').trim();
    if (phone.length > 20) throw new ProfileError('invalid_contact_phone');

    // Audit §17.3 — reject illegal onboarding state transitions. Allowed
    // source states: pending_basic_info (normal flow) and pending_avatar
    // (idempotent re-run from the same step). 'completed' would be a
    // rollback and is rejected.
    const { state } = await this.users.getOnboardingBootstrap(input.userId);
    if (state === 'completed') {
      throw new OnboardingError(
        'illegal_transition',
        `cannot rerun basic info from state '${state}'`,
      );
    }

    // The date of birth goes first: the server re-checks the age, so a rejected one saves nothing else.
    await this.users.setDateOfBirth(input.dateOfBirth);
    await this.users.setBasicInfo(input.userId, {
      displayName: trimmedName,
      city: trimmedCityId,
      cityName: trimmedCityName,
    });
    if (st.length > 0 && num.length > 0) {
      await this.users.setProfileAddressLines(input.userId, st, num);
    } else {
      await this.users.setProfileAddressLines(input.userId, null, null);
    }
    await this.users.setContactPhone(input.userId, phone.length > 0 ? phone : null);
    await this.users.setOnboardingState('pending_avatar');
    await this.auth.syncProfileMetadata({ displayName: trimmedName });
  }
}
