import i18n from '../i18n';

/** Maps UpdateProfileUseCase / adapter error codes to user-visible messages. */
export function mapEditProfileSaveError(code: string): string {
  // Order matters: keys are matched via `code.includes(k)` and the first hit
  // wins. Longer keys MUST precede their prefixes so e.g.
  // `invalid_profile_street_number` is not shadowed by `invalid_profile_street`.
  const keys: Record<string, string> = {
    invalid_profile_street_number: 'errors.profile.invalid_profile_street_number',
    invalid_profile_street: 'errors.profile.invalid_profile_street',
    incomplete_profile_address: 'errors.profile.incomplete_profile_address',
    invalid_contact_phone: 'errors.profile.invalid_contact_phone',
    invalid_display_name: 'errors.profile.invalid_display_name',
    biography_too_long: 'errors.profile.biography_too_long',
    biography_url_forbidden: 'errors.profile.biography_url_forbidden',
    invalid_city: 'errors.profile.invalid_city',
    invalid_date_of_birth: 'dateOfBirth.errors.invalid',
    underage: 'dateOfBirth.errors.underage',
  };
  const match = Object.keys(keys).find((k) => code.includes(k));
  return match ? i18n.t(keys[match]!) : code;
}
