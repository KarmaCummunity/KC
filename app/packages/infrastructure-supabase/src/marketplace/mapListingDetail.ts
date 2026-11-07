import type { MarketplaceListingDetail } from '@kc/domain';
import { toVerificationLevel } from '@kc/domain';

export function mapListingDetail(raw: unknown): MarketplaceListingDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const ownerRaw = o.owner as Record<string, unknown> | null | undefined;
  const mediaRaw = (o.media ?? []) as Array<Record<string, unknown>>;
  const geo = o.geo as { coordinates?: [number, number] } | null | undefined;
  const coords = geo?.coordinates;

  return {
    listingId: String(o.listing_id),
    ownerId: String(o.owner_id),
    worldSlug: String(o.world_slug),
    worldLabelEn: String(o.world_label_en ?? ''),
    worldLabelHe: String(o.world_label_he ?? ''),
    kindSlug: String(o.kind_slug),
    kindLabelEn: String(o.kind_label_en ?? ''),
    kindLabelHe: String(o.kind_label_he ?? ''),
    direction: o.direction === 'request' ? 'request' : 'give',
    title: String(o.title),
    summary: o.summary != null ? String(o.summary) : null,
    details: (o.details as Record<string, unknown>) ?? {},
    cityId: o.city_id != null ? String(o.city_id) : null,
    urgencyLevel: Number(o.urgency_level ?? 2),
    availabilityStatus: String(o.availability_status ?? 'ongoing'),
    listingStatus: String(o.status ?? ''),
    publishedAt: o.published_at != null ? String(o.published_at) : null,
    lat: coords && coords.length >= 2 ? coords[1] : null,
    lng: coords && coords.length >= 2 ? coords[0] : null,
    maxRadiusKm: o.max_radius_km != null ? Number(o.max_radius_km) : null,
    media: mediaRaw.map((m) => ({
      storagePath: String(m.storage_path),
      sortOrder: Number(m.sort_order ?? 0),
    })),
    owner: ownerRaw
      ? {
          userId: String(ownerRaw.user_id),
          displayName: ownerRaw.display_name != null ? String(ownerRaw.display_name) : null,
          avatarUrl: ownerRaw.avatar_url != null ? String(ownerRaw.avatar_url) : null,
          shareHandle: ownerRaw.share_handle != null ? String(ownerRaw.share_handle) : null,
          cityId: ownerRaw.city_id != null ? String(ownerRaw.city_id) : null,
          verificationLevel: toVerificationLevel(ownerRaw.verification_level),
        }
      : null,
    feedPostId: o.feed_post_id != null ? String(o.feed_post_id) : null,
    feedHidden: o.feed_hidden === true,
  };
}
