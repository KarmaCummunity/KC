// Maps a refused listing-owner action (pause, resume, fulfil, delete, edit, add photos) to the
// copy key that explains it. The owner RPCs raise these codes as the exception message
// (migrations 0338 / 0543; spec 07 §7.1 "Owner management"); anything else is generic, so a
// raw server message never reaches the screen.

const OWNER_ERROR_KEYS: Readonly<Record<string, string>> = {
  listing_wrong_status: 'marketplace.myListingsErrorWrongStatus',
  listing_has_active_handoff: 'marketplace.myListingsErrorActiveHandoff',
  listing_has_handoff_history: 'marketplace.myListingsErrorHandoffHistory',
  listing_expired: 'marketplace.myListingsErrorExpired',
  listing_media_full: 'marketplace.myListingsErrorMediaFull',
  listing_not_editable: 'marketplace.myListingsErrorNotEditable',
  listing_not_found: 'marketplace.myListingsErrorNotFound',
};

const GENERIC_KEY = 'marketplace.myListingsErrorGeneric';

/** The i18n key for a thrown owner-action error (a PostgrestError, an Error, or anything else). */
export function listingOwnerErrorKey(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== 'string') return GENERIC_KEY;
  return OWNER_ERROR_KEYS[message.trim()] ?? GENERIC_KEY;
}
