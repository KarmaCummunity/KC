// A `post_card` (the one shape every post list of the baseline returns) → the domain `Post`.
//
// The card carries the post, its owner, the location name, the cover photo, the counters and the
// viewer's own state, with the owner already masked by the server when the post hides its poster
// (FR-POST-021, `owner_identity_masked`). Whatever the app still needs and the card lacks — the
// recipient, the approximate map point, the purge deadline — arrives in `CardExtras`, loaded once
// per page by `postCardExtras.ts`. Fields that no longer exist in the baseline get the neutral
// values documented on `mapCardToPost`.

import {
  ITEM_CONDITIONS,
  toVerificationLevel,
  type Address,
  type ItemCondition,
  type LocationDisplayLevel,
  type MediaAsset,
  type Post,
  type PostStatus,
  type PostStatusBeforeAdminRemoval,
  type PostVisibility,
  type Recipient,
} from '@kc/domain';
import type { PostWithOwner } from '@kc/application';
import type { Database, Json } from '../database.types';
import { ITEMS_WORLD, postTypeOf, type PostCatalog } from './postCatalog';
import { postMapPoint } from './postMapPoint';

/** One card as returned by `post_cards`, `feed_page`, `profile_posts_page`, ... */
export type PostCardRow = Database['public']['CompositeTypes']['post_card'];
/** A row of `public.post_media`. */
export type PostMediaRow = Database['public']['Tables']['post_media']['Row'];

/** Who received a delivered post, as far as the caller may know (the owner and the recipient). */
export interface CardRecipient {
  readonly recipient: Recipient;
  readonly user: NonNullable<PostWithOwner['recipientUser']>;
}

/** What a page of cards is completed with after the first call. */
export interface CardExtras {
  /** `posts.geo_approx` as PostgREST serialises it (hex WKB). */
  readonly geo: unknown;
  /** The street and (with FullAddress) number the poster's display level shows to others. */
  readonly shownStreet?: string | null;
  readonly shownStreetNumber?: string | null;
  readonly sourceLanguage: string | null;
  readonly statusBeforeRemoval: string | null;
  /** `challenges.id` when the post is a challenge's post. */
  readonly challengeId: string | null;
  /** End of the seven-day restore window of a post deleted without a recipient (owner only). */
  readonly purgeAfter: string | null;
  readonly recipient: CardRecipient | null;
}

export interface MapCardContext {
  readonly catalog: PostCatalog;
  readonly extras?: CardExtras;
  /** Every media row of the post (detail); a list carries the cover only. */
  readonly media?: readonly MediaAsset[];
  /** The exact address, readable by the owner only (`post_private_locations`); wins over the shown one. */
  readonly street?: { readonly street: string; readonly streetNumber: string };
  /** Metres from the proximity-sort centre (`feed_page` with the nearest sort). */
  readonly distanceM?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string field of the post's `details` document, or null. */
export function detailString(details: Json | null, key: string): string | null {
  if (!isRecord(details)) return null;
  const value = details[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A numeric field of the post's `details` document, or null. */
export function detailNumber(details: Json | null, key: string): number | null {
  if (!isRecord(details)) return null;
  const value = details[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A media row (one file of the gallery) → the domain asset. The path is the storage key. */
export function mapMediaRow(row: PostMediaRow): MediaAsset {
  return {
    mediaAssetId: row.id,
    postId: row.post_id,
    bucket: row.storage_bucket === 'listing-images' ? 'listing-images' : 'post-images',
    path: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

/**
 * The cover file a card carries (`cover_media`). The card does not say the size or the upload time,
 * so the asset gets the file kind's usual type, size 0 and the post's own creation time: the screens
 * read only `path` and `bucket` of a cover.
 */
function mapCover(card: PostCardRow): MediaAsset[] {
  const cover = card.cover_media;
  if (!isRecord(cover) || typeof cover['id'] !== 'string' || typeof cover['storage_key'] !== 'string') return [];
  return [
    {
      mediaAssetId: cover['id'],
      postId: card.id,
      bucket: cover['storage_bucket'] === 'listing-images' ? 'listing-images' : 'post-images',
      path: cover['storage_key'],
      mimeType: cover['kind'] === 'video' ? 'video/mp4' : 'image/jpeg',
      sizeBytes: 0,
      createdAt: card.created_at ?? '',
    },
  ];
}

function mapItemCondition(details: Json | null): ItemCondition | null {
  const value = detailString(details, 'item_condition');
  return ITEM_CONDITIONS.find((condition) => condition === value) ?? null;
}

function mapAddress(card: PostCardRow, ctx: MapCardContext): Address {
  return {
    city: card.city_id ?? '',
    cityName: card.city_name_he ?? card.city_id ?? '',
    street: ctx.street?.street ?? ctx.extras?.shownStreet ?? '',
    streetNumber: ctx.street?.streetNumber ?? ctx.extras?.shownStreetNumber ?? '',
  };
}

/**
 * The domain post of a card. Differences from the old row:
 * - `ownerId` is '' while the poster is masked (the card has no owner id then);
 * - `category` is the item category of the subcategory, 'Other' for a post of another world;
 * - `itemCondition`, `estimatedValue` and `urgency` live in the free `details` document
 *   (`item_condition`, `estimated_value`, `urgency_note`);
 * - the exact street is known only to the owner; everybody else gets the street (and with
 *   FullAddress the number) the poster's display level shows, or '' (migration 0029);
 * - a post of a world other than items is a "listing": `listingId` is the post's own id and
 *   `listingWorldSlug` its world, which routes its detail and edit screens to the world's flow;
 * - `reopenCount` is not readable (an internal moderation signal) and stays 0.
 */
export function mapCardToPost(card: PostCardRow, ctx: MapCardContext): Post {
  const extras = ctx.extras;
  const isWorldPost = card.world_slug !== null && card.world_slug !== ITEMS_WORLD;
  return {
    postId: card.id ?? '',
    ownerId: card.owner_id ?? '',
    type: postTypeOf(card.direction),
    status: (card.status ?? 'open') as PostStatus,
    statusBeforeAdminRemoval: (extras?.statusBeforeRemoval as PostStatusBeforeAdminRemoval | null) ?? null,
    visibility: (card.visibility ?? 'Public') as PostVisibility,
    title: card.title ?? '',
    description: card.description,
    category: (card.item_subcategory_id ? ctx.catalog.categoryOf.get(card.item_subcategory_id) : undefined) ?? 'Other',
    address: mapAddress(card, ctx),
    locationDisplayLevel: (card.location_display_level ?? 'CityAndStreet') as LocationDisplayLevel,
    itemCondition: mapItemCondition(card.details),
    urgency: detailString(card.details, 'urgency_note'),
    estimatedValue: detailNumber(card.details, 'estimated_value'),
    mediaAssets: ctx.media ? [...ctx.media] : mapCover(card),
    recipient: extras?.recipient?.recipient ?? null,
    reopenCount: 0,
    deleteAfter: extras?.purgeAfter ?? null,
    listingId: isWorldPost ? (card.id ?? null) : null,
    listingWorldSlug: isWorldPost ? card.world_slug : null,
    challengeId: extras?.challengeId ?? null,
    mapPoint: postMapPoint(extras?.geo, null),
    createdAt: card.created_at ?? '',
    updatedAt: card.created_at ?? '',
    sourceLanguage: extras?.sourceLanguage ?? null,
  };
}

/** The domain post with its owner (and, for a delivered post, the recipient) shown on a card. */
export function mapCardToPostWithOwner(card: PostCardRow, ctx: MapCardContext): PostWithOwner {
  const masked = card.owner_identity_masked === true;
  return {
    ...mapCardToPost(card, ctx),
    ownerName: card.owner_display_name,
    ownerAvatarUrl: card.owner_avatar_url,
    ownerHandle: card.owner_share_handle ?? '',
    ownerPrivacyMode: 'Public',
    ownerVerificationLevel: toVerificationLevel(card.owner_verification_level),
    recipientUser: ctx.extras?.recipient?.user ?? null,
    distanceKm: typeof ctx.distanceM === 'number' ? ctx.distanceM / 1000 : null,
    ownerProfileNavigableFromPost: !masked,
    recipientProfileNavigableFromPost: true,
  };
}
