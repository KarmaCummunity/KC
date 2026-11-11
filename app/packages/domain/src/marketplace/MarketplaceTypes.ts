// Unified giving marketplace (Epic #893).
import type { VerificationLevel } from '../verificationLevel';

export const MARKETPLACE_WORLD_SLUGS = [
  'money',
  'items',
  'food',
  'medical',
  'housing',
  'rides',
  'knowledge',
  'time',
  'animals',
  'environment',
  'creative',
  'app_design',
] as const;

export type MarketplaceWorldSlug = (typeof MARKETPLACE_WORLD_SLUGS)[number];

export interface MarketplaceBrowseRow {
  readonly listingId: string;
  readonly worldSlug: string;
  readonly kindSlug: string;
  readonly direction: 'give' | 'request';
  readonly title: string;
  readonly summary: string | null;
  readonly urgencyLevel: number;
  readonly availabilityStatus: string;
  readonly cityId: string | null;
  readonly distanceKm: number | null;
  /** Rides world only — route/time/seats from listing details (filled client-side). */
  readonly ride?: RideCardSummary | null;
  /** Who published the listing, for the card's author row (docs/spec/07 §7.4); filled client-side. */
  readonly publisher?: ListingCardPublisher | null;
}

/** The publisher a listing card shows: the same person the listing page shows. */
export interface ListingCardPublisher {
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

export interface RideCardSummary {
  readonly originLabel: string | null;
  readonly destLabel: string | null;
  readonly departsAt: string | null;
  readonly seats: number | null;
}

export interface MarketplaceMapCluster {
  readonly clusterKey: string;
  readonly centerLat: number;
  readonly centerLng: number;
  readonly listingCount: number;
  readonly sampleListingId: string | null;
}

export interface MarketplaceListingOwner {
  readonly userId: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly shareHandle: string | null;
  readonly cityId: string | null;
  /** FR-VERIFY-001 — publisher badge on listing detail. */
  readonly verificationLevel?: VerificationLevel;
}

export interface MarketplaceListingMedia {
  readonly storagePath: string;
  readonly sortOrder: number;
}

export interface MarketplaceListingDetail {
  readonly listingId: string;
  readonly ownerId: string;
  readonly worldSlug: string;
  readonly worldLabelEn: string;
  readonly worldLabelHe: string;
  readonly kindSlug: string;
  readonly kindLabelEn: string;
  readonly kindLabelHe: string;
  readonly direction: 'give' | 'request';
  readonly title: string;
  readonly summary: string | null;
  readonly details: Record<string, unknown>;
  readonly cityId: string | null;
  readonly urgencyLevel: number;
  readonly availabilityStatus: string;
  /** Lifecycle state of the listing row (open, closed, cancelled, etc.). */
  readonly listingStatus?: string;
  readonly publishedAt: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly maxRadiusKm: number | null;
  readonly media: readonly MarketplaceListingMedia[];
  readonly owner: MarketplaceListingOwner | null;
  /** The listing's post, when it has one (D-206, D-218); null until published. */
  readonly feedPostId: string | null;
  /** The post exists but the main feed does not list it yet (0557): unshared, or a later ride occurrence. */
  readonly feedHidden: boolean;
}

export interface MarketplaceSimilarListing {
  readonly listingId: string;
  readonly title: string;
  readonly worldSlug: string;
  readonly kindSlug: string;
}

export interface ListingKindOption {
  readonly kindId: string;
  readonly slug: string;
  readonly labelEn: string;
  readonly labelHe: string;
  readonly direction: 'give' | 'request' | 'either';
  readonly detailSchema: Record<string, unknown>;
}

/**
 * A giving world's subcategory (`public.categories` child row), e.g. items → books, food →
 * bakery. Glossary: "world subcategory" / "item subcategory" (docs/spec/94). KC#1296.
 */
export interface WorldSubcategory {
  readonly categoryId: string;
  readonly slug: string;
  readonly labelHe: string;
  /** Some seeded rows have no English label; callers fall back to `labelHe`. */
  readonly labelEn: string | null;
}

/** Primary donation worlds exposed in the create hub (PRD + medical for blood/organs). */
export const MARKETPLACE_CREATE_WORLD_SLUGS = [
  'money',
  'time',
  'items',
  'food',
  'rides',
  'housing',
  'knowledge',
  'medical',
  'animals',
  'environment',
] as const;

export type MarketplaceCreateWorldSlug = (typeof MARKETPLACE_CREATE_WORLD_SLUGS)[number];

export interface MyListingRow {
  readonly listingId: string;
  readonly worldSlug: string;
  readonly kindSlug: string;
  readonly direction: 'give' | 'request';
  readonly status: string;
  readonly title: string;
  readonly summary: string | null;
  readonly urgencyLevel: number;
  readonly availabilityStatus: string;
  readonly updatedAt: string;
  /** Post the closure sheet closes; null when the listing has no feed post yet. */
  readonly feedPostId: string | null;
}

export interface ProfileListingRow {
  readonly listingId: string;
  readonly worldSlug: string;
  readonly kindSlug: string;
  readonly direction: 'give' | 'request';
  readonly status: string;
  readonly title: string;
  readonly summary: string | null;
}

export interface GivingHandoffSnapshot {
  readonly handoffId: string;
  readonly listingId: string;
  readonly ownerId: string;
  readonly recipientId: string;
  readonly worldSlug: string;
  readonly status: string;
  readonly pickupMode: string;
  readonly pickupWindowStart: string | null;
  readonly pickupWindowEnd: string | null;
  readonly confirmBy: string | null;
  readonly reservedAt: string;
  readonly confirmedAt: string | null;
}

export interface MyGivingHandoffRow {
  readonly handoffId: string;
  readonly listingId: string;
  readonly title: string;
  readonly worldSlug: string;
  readonly status: string;
  readonly role: 'owner' | 'recipient';
  readonly pickupWindowStart: string | null;
  readonly pickupWindowEnd: string | null;
  readonly reservedAt: string;
}
