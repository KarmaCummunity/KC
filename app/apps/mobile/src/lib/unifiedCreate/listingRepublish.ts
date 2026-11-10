// Mapped to spec: D127 (docs/spec/90_decisions_log.md) — an expired post is never reopened; its
// owner republishes it as a NEW post that carries all of its fields except its dates. Pure
// helpers shared by the post detail's "Republish" action and the create form's republish mode.
import { ORG_EVENT_KIND_SLUG, type MarketplaceListingDetail, type PostStatus } from '@kc/domain';
import {
  isCreateCategoryId,
  type CreateCategoryId,
  type CreateDirection,
} from './createCategories';

/**
 * Every listing detail key that pins a post to a moment in time. A republished post must get new
 * dates from its owner, so these never carry over. Sources (the kinds' detail schemas): food offer
 * (`expires_at`, `pickup_window_start`, `pickup_window_end`), ride schedule (`departs_at`,
 * `arrives_at`), organization event (`starts_at`, `ends_at`), housing request stay
 * (`check_in_date`, `check_out_date`), housing offer (`blackout_dates`), animal care window
 * (`starts_on`, `ends_on`), knowledge lesson slot (`slot_starts_at`, `slot_ends_at`) and medical
 * appointments (`appointment_at`).
 */
export const TIME_BOUND_DETAIL_KEYS: readonly string[] = [
  'expires_at',
  'pickup_window_start',
  'pickup_window_end',
  'departs_at',
  'arrives_at',
  'starts_at',
  'ends_at',
  'check_in_date',
  'check_out_date',
  'blackout_dates',
  'starts_on',
  'ends_on',
  'slot_starts_at',
  'slot_ends_at',
  'appointment_at',
];

/** A copy of `details` without its time-bound keys; the input is never mutated. */
export function withoutTimeBoundDetails(
  details: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([key]) => !TIME_BOUND_DETAIL_KEYS.includes(key)));
}

/** The post fields the "Republish" action decides on (a subset of the post entity). */
export interface RepublishablePost {
  readonly ownerId: string;
  readonly status: PostStatus;
  /** Set only for a post of a listing world (food, rides, housing, time…). */
  readonly listingId: string | null;
}

/** Whether the viewer sees "Republish": only the owner of an expired listing-world post. */
export function canRepublishListingPost(post: RepublishablePost, viewerId: string | null): boolean {
  return viewerId !== null && post.ownerId === viewerId && post.status === 'expired' && Boolean(post.listingId);
}

/** The create form route that republishes `listingId` (equal to its post id since 0667). */
export function republishRoute(listingId: string): { pathname: '/create'; params: { republishFrom: string } } {
  return { pathname: '/create', params: { republishFrom: listingId } };
}

/** Where the create form opens for a republish: the source's world and request / offer. */
export interface RepublishTarget {
  readonly categoryId: CreateCategoryId;
  readonly direction: CreateDirection;
}

/**
 * The create category and direction that republish `source`, or null when the viewer may not
 * republish it (someone else's post) or its world has no listing create form.
 */
export function republishTargetFor(
  source: Pick<MarketplaceListingDetail, 'ownerId' | 'worldSlug' | 'direction'>,
  viewerId: string | null | undefined,
): RepublishTarget | null {
  if (!viewerId || source.ownerId !== viewerId || !isCreateCategoryId(source.worldSlug)) return null;
  // Items publish through the post form, which has no listing republish mode.
  if (source.worldSlug === 'items') return null;
  return { categoryId: source.worldSlug, direction: source.direction };
}

/** What the listing form starts from when it republishes a source listing. */
export interface ListingRepublishSeed {
  /** The source's kind; its details apply once the form shows that kind. */
  readonly kindSlug: string;
  /** The source's details minus dates and the event's organization (picked separately). */
  readonly details: Record<string, unknown>;
  readonly isOrgEvent: boolean;
  readonly orgId: string | null;
  /** The source's photos, in order; reused as-is (already in the owner's storage folder). */
  readonly mediaPaths: string[];
}

/** The republish seed of `source` (see ListingRepublishSeed). */
export function listingRepublishSeed(
  source: Pick<MarketplaceListingDetail, 'kindSlug' | 'details' | 'media'>,
): ListingRepublishSeed {
  const { org_id: orgId, ...rest } = withoutTimeBoundDetails(source.details);
  return {
    kindSlug: source.kindSlug,
    details: rest,
    isOrgEvent: source.kindSlug === ORG_EVENT_KIND_SLUG,
    orgId: typeof orgId === 'string' ? orgId : null,
    mediaPaths: [...source.media].sort((a, b) => a.sortOrder - b.sortOrder).map((m) => m.storagePath),
  };
}
