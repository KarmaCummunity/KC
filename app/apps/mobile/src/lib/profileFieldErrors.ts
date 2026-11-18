// Mapped to spec: FR-PROFILE-007 / FR-AUTH-010 / FR-AUTH-015 / FR-RESP-006 AC29 — what is wrong with a
// profile form (edit profile, onboarding basic info, the basic-info soft gate), field by field, so each
// message shows under the field it belongs to and the form can jump to the first.
import { dateOfBirthIssue } from '@kc/domain';
import { getProfileAddressPairIssue } from './profileAddressFieldGate';

/** Longest display name a profile accepts. */
export const DISPLAY_NAME_MAX = 50;
/** Longest contact phone a profile accepts. */
export const CONTACT_PHONE_MAX = 20;

export interface ProfileFieldValues {
  readonly displayName: string;
  readonly cityId: string | null;
  readonly street: string;
  readonly streetNumber: string;
  readonly contactPhone: string;
  /** ISO date, or null while the typed parts do not form a real date. */
  readonly dateOfBirth: string | null;
  /** Check the date of birth: always in onboarding (it is required), on edit only once it changed. */
  readonly dateOfBirthChanged: boolean;
}

/** One message per field; a field with no problem has no key. */
export interface ProfileFieldErrors {
  readonly displayName?: string;
  /** City, street and house number share one message: they are one address. */
  readonly address?: string;
  readonly contactPhone?: string;
  readonly dateOfBirth?: string;
}

export function profileFieldErrors(values: ProfileFieldValues, t: (key: string) => string, now: Date): ProfileFieldErrors {
  const name = values.displayName.trim();
  const street = values.street.trim();
  const number = values.streetNumber.trim();
  return {
    ...(name.length === 0 || name.length > DISPLAY_NAME_MAX ? { displayName: t('profile.editScreen.invalidNameMessage') } : {}),
    ...addressError(values.cityId, street, number, t),
    ...(values.contactPhone.trim().length > CONTACT_PHONE_MAX ? { contactPhone: t('profile.editScreen.invalidContactPhoneMessage') } : {}),
    ...dateOfBirthError(values, t, now),
  };
}

/** True when the form has nothing to fix. */
export function isProfileValid(errors: ProfileFieldErrors): boolean {
  return Object.keys(errors).length === 0;
}

function addressError(cityId: string | null, street: string, number: string, t: (key: string) => string) {
  if (!cityId) return { address: t('profile.editScreen.missingCityMessage') };
  // Street and house number go together (and follow the server's format rules, `profileAddressFieldGate`).
  switch (getProfileAddressPairIssue(street, number)) {
    case null:
      return {};
    case 'incomplete_profile_address':
      return { address: t(street ? 'profile.editScreen.incompleteAddressMessageNumber' : 'profile.editScreen.incompleteAddressMessageStreet') };
    case 'invalid_profile_street':
      return { address: t('errors.profile.invalid_profile_street') };
    case 'invalid_profile_street_number':
      return { address: t('errors.profile.invalid_profile_street_number') };
  }
}

function dateOfBirthError(values: ProfileFieldValues, t: (key: string) => string, now: Date) {
  if (!values.dateOfBirthChanged) return {};
  const issue = values.dateOfBirth ? dateOfBirthIssue(values.dateOfBirth, now) : 'invalid_date_of_birth';
  if (!issue) return {};
  return { dateOfBirth: t(issue === 'underage' ? 'dateOfBirth.errors.underage' : 'dateOfBirth.errors.invalid') };
}
