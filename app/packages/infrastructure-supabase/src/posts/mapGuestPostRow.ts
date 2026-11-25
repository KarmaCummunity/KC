import type { GuestPost } from '@kc/application';

/** Shared projection for `guest_posts` / `guest_profile_posts` rows. */
export function mapGuestPostRow(row: {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly city_name_he: string;
  readonly city_name_en: string;
  /** Generated as `string`; runtime null when the author is not Public. */
  readonly author_share_handle: string | null;
}): GuestPost {
  const handle = (row.author_share_handle ?? '').trim() || null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    cityNameHe: row.city_name_he,
    cityNameEn: row.city_name_en,
    authorShareHandle: handle,
  };
}
