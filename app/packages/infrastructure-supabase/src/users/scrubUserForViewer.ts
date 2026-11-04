import type { User } from '@kc/domain';

const DEFAULT_NOTIFICATION_PREFS = { critical: true, social: true } as const;

/** Adapter-side scrub when the viewer is not the row owner (defense in depth; TD-163). */
export function scrubUserForNonOwner(user: User): User {
  return {
    ...user,
    contactPhone: null,
    dateOfBirth: null,
    profileStreet: null,
    profileStreetNumber: null,
    notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFS },
    isSuperAdmin: false,
    activePostsCountInternal: 0,
  };
}
