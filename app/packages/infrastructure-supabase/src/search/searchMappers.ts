import { toVerificationLevel, type DonationCategorySlug, type DonationLinkSearchResult, type UserSearchResult } from '@kc/domain';
import type { Database } from '../database.legacy.types';
export type LinkRow = Database['public']['Tables']['donation_links']['Row'] & { tags?: string | null };
export interface SearchUserRow {
  user_id: string; display_name: string | null; share_handle: string;
  avatar_url: string | null; biography: string | null;
  city: string | null; city_name: string | null; followers_count: number; items_given_count: number;
  verification_level?: number | null;
}
export function mapUserSearchResult(row: SearchUserRow): UserSearchResult {
  return { userId: row.user_id, displayName: row.display_name, shareHandle: row.share_handle,
    avatarUrl: row.avatar_url, biography: row.biography, city: row.city, cityName: row.city_name,
    followersCount: row.followers_count, itemsGivenCount: row.items_given_count,
    verificationLevel: toVerificationLevel(row.verification_level) };
}
export function mapLinkSearchResult(row: LinkRow): DonationLinkSearchResult {
  return { id: row.id, categorySlug: row.category_slug as DonationCategorySlug,
    url: row.url, displayName: row.display_name, description: row.description, tags: row.tags ?? null };
}
