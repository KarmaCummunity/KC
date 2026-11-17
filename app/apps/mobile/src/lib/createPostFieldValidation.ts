import i18n from '../i18n';

export interface CreatePostFieldSnapshot {
  readonly isGive: boolean;
  readonly title: string;
  readonly city: { id: string; name: string } | null;
  readonly street: string;
  readonly streetNumber: string;
  readonly uploadsLength: number;
}

export type AddressValidationIssue =
  | 'none'
  | 'city'
  | 'street'
  | 'streetNumber'
  | 'streetAndNumber';

export function getAddressValidationIssue(
  city: CreatePostFieldSnapshot['city'],
  street: string,
  streetNumber: string,
): AddressValidationIssue {
  if (city === null) return 'city';
  if (street.trim().length === 0 && streetNumber.trim().length === 0) return 'streetAndNumber';
  if (street.trim().length === 0) return 'street';
  if (streetNumber.trim().length === 0) return 'streetNumber';
  return 'none';
}

export function buildAddressInlineErrorMessage(issue: AddressValidationIssue): string {
  switch (issue) {
    case 'city':
      return i18n.t('errors.createPost.missingCityBeforePublish');
    case 'street':
      return i18n.t('errors.createPost.missingStreetBeforePublish');
    case 'streetNumber':
      return i18n.t('errors.createPost.missingStreetNumberBeforePublish');
    case 'streetAndNumber':
      return i18n.t('errors.createPost.missingAddressPairBeforePublish');
    default:
      return '';
  }
}

function isStreetMissing(s: CreatePostFieldSnapshot): boolean {
  return s.street.trim().length === 0;
}

function isStreetNumberMissing(s: CreatePostFieldSnapshot): boolean {
  return s.streetNumber.trim().length === 0;
}

/** Non-address required fields — toast only (title, photo). Address uses inline errors. */
export function buildCreatePostNonAddressToastMessage(s: CreatePostFieldSnapshot): string {
  const missing: string[] = [];
  if (s.title.trim().length === 0) missing.push(i18n.t('errors.createPost.fieldTitle'));
  if (s.isGive && s.uploadsLength === 0) missing.push(i18n.t('errors.createPost.fieldPhoto'));
  if (missing.length === 0) return '';
  if (missing.length === 1) return i18n.t('errors.createPost.missingOne', { field: missing[0] });
  return i18n.t('errors.createPost.missingMany', { fields: missing.join(', ') });
}

export function hasNonAddressRequiredFieldGaps(s: CreatePostFieldSnapshot): boolean {
  if (s.title.trim().length === 0) return true;
  if (s.isGive && s.uploadsLength === 0) return true;
  return false;
}

export function hasAddressRequiredFieldGaps(
  city: CreatePostFieldSnapshot['city'],
  street: string,
  streetNumber: string,
): boolean {
  return getAddressValidationIssue(city, street, streetNumber) !== 'none';
}

export { isStreetMissing, isStreetNumberMissing };

/** The inline problem of each required part of the items form; null where nothing is wrong. */
export interface PostFieldErrors {
  readonly title: string | null;
  readonly photo: string | null;
  readonly address: string | null;
}

/**
 * What the items form (create and edit alike, FR-RESP-006 AC27/AC29) marks under each required
 * part: a title, at least one photo for a give post, and a full address.
 */
export function postFieldErrors(s: CreatePostFieldSnapshot): PostFieldErrors {
  const addressIssue = getAddressValidationIssue(s.city, s.street, s.streetNumber);
  return {
    title: s.title.trim().length === 0 ? i18n.t('createPostValidation.missingTitle') : null,
    photo: s.isGive && s.uploadsLength === 0 ? i18n.t('createPostValidation.missingPhoto') : null,
    address: addressIssue === 'none' ? null : buildAddressInlineErrorMessage(addressIssue),
  };
}

/** True when the items form has nothing to fix. */
export function hasPostFieldErrors(errors: PostFieldErrors): boolean {
  return errors.title !== null || errors.photo !== null || errors.address !== null;
}
