// Rows of the baseline → the search result types of the domain.
import {
  type DonationCategorySlug,
  type DonationLinkSearchResult,
  type User,
  type UserSearchResult,
} from '@kc/domain';
import type { Database } from '../database.types';

/** A row of `public.donation_links`. */
export type LinkRow = Pick<
  Database['public']['Tables']['donation_links']['Row'],
  'id' | 'category_slug' | 'url' | 'display_name' | 'description'
>;

/** Columns of `donation_links` a search result needs. */
export const LINK_COLUMNS = 'id, category_slug, url, display_name, description' as const;

/** A member as a search result: the profile, the counters and the city name of the hydrated user. */
export function mapUserSearchResult(user: User): UserSearchResult {
  return {
    userId: user.userId,
    displayName: user.displayName,
    shareHandle: user.shareHandle,
    avatarUrl: user.avatarUrl,
    biography: user.biography,
    city: user.city,
    cityName: user.cityName,
    followersCount: user.followersCount,
    itemsGivenCount: user.itemsGivenCount,
    verificationLevel: user.verificationLevel,
  };
}

/** A donation link as a search result. Links carry no tags in the baseline. */
export function mapLinkSearchResult(row: LinkRow): DonationLinkSearchResult {
  return {
    id: row.id,
    categorySlug: row.category_slug as DonationCategorySlug,
    url: row.url,
    displayName: row.display_name,
    description: row.description,
    tags: null,
  };
}
