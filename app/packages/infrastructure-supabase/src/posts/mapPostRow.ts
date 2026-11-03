import type {
  Address,
  Category,
  ItemCondition,
  LocationDisplayLevel,
  MediaAsset,
  Post,
  PostStatus,
  PostType,
  PostVisibility,
} from '@kc/domain';
import type { PostWithOwner } from '@kc/application';
import type { Database } from '../database.types';

type PostRow = Database['public']['Tables']['posts']['Row'];
type MediaAssetRow = Database['public']['Tables']['media_assets']['Row'];
type RecipientRow = Database['public']['Tables']['recipients']['Row'];
type UserRow = Database['public']['Tables']['users']['Row'];

type RecipientWithUserRow = RecipientRow & {
  user?: Pick<UserRow, 'user_id' | 'display_name' | 'avatar_url' | 'share_handle'> | null;
};

export interface PostJoinedRow extends PostRow {
  city_ref?: { name_he: string } | null;
  media_assets?: MediaAssetRow[] | null;
  recipient?: RecipientWithUserRow | null;
  // source_language is inherited from PostRow (database.types.ts Row type)
}

export interface PostWithOwnerJoinedRow extends PostJoinedRow {
  owner: Pick<
    UserRow,
    'user_id' | 'display_name' | 'avatar_url' | 'share_handle' | 'privacy_mode'
  > | null;
}

function mapMediaAsset(row: MediaAssetRow): MediaAsset {
  return {
    mediaAssetId: row.media_asset_id,
    postId: row.post_id,
    bucket: row.bucket === 'listing-images' ? 'listing-images' : 'post-images',
    path: row.path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

function mapAddress(row: PostJoinedRow): Address {
  return {
    city: row.city,
    cityName: row.city_ref?.name_he ?? row.city,
    street: row.street,
    streetNumber: row.street_number,
  };
}

export function mapPostRow(row: PostJoinedRow): Post {
  const media = (row.media_assets ?? []).slice().sort((a, b) => a.ordinal - b.ordinal);
  return {
    postId: row.post_id,
    ownerId: row.owner_id,
    type: row.type as PostType,
    status: row.status as PostStatus,
    statusBeforeAdminRemoval:
      (row.status_before_admin_removal as 'open' | 'closed_delivered' | 'deleted_no_recipient' | null) ?? null,
    visibility: row.visibility as PostVisibility,
    title: row.title,
    description: row.description,
    category: row.category as Category,
    address: mapAddress(row),
    locationDisplayLevel: row.location_display_level as LocationDisplayLevel,
    itemCondition: (row.item_condition as ItemCondition | null) ?? null,
    urgency: row.urgency,
    estimatedValue: (row as { estimated_value?: number | null }).estimated_value ?? null,
    mediaAssets: media.map(mapMediaAsset),
    recipient: row.recipient
      ? {
          postId: row.recipient.post_id,
          recipientUserId: row.recipient.recipient_user_id,
          markedAt: row.recipient.marked_at,
        }
      : null,
    reopenCount: row.reopen_count,
    listingId: row.listing_id ?? null,
    listingWorldSlug: row.listing_world_slug ?? null,
    deleteAfter: row.delete_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceLanguage: row.source_language ?? null,
  };
}

function mapRecipientUser(row: PostJoinedRow): PostWithOwner['recipientUser'] {
  const u = row.recipient?.user;
  if (!u) return null;
  return {
    userId: u.user_id,
    displayName: u.display_name,
    shareHandle: u.share_handle,
    avatarUrl: u.avatar_url,
  };
}

export function mapPostWithOwnerRow(row: PostWithOwnerJoinedRow): PostWithOwner {
  // Owner can be null when the user_id is orphaned in public.users (the FK
  // posts_owner_id_fkey is ON DELETE cascade, but defensive coding still
  // handles a stale join). Per D-21, users RLS no longer hides Private
  // profiles from non-followers, so privacy mode is no longer a reason for
  // a null owner. Return ownerName: null so the UI renders the localized
  // placeholder (FR-CHAT-013 convention); one orphan post must not crash
  // the feed.
  const recipientUser = mapRecipientUser(row);
  if (!row.owner) {
    return {
      ...mapPostRow(row),
      ownerName: null,
      ownerAvatarUrl: null,
      ownerHandle: '',
      ownerPrivacyMode: 'Public',
      recipientUser,
      distanceKm: null,
    };
  }
  return {
    ...mapPostRow(row),
    ownerName: row.owner.display_name,
    ownerAvatarUrl: row.owner.avatar_url,
    ownerHandle: row.owner.share_handle,
    ownerPrivacyMode: row.owner.privacy_mode as 'Public' | 'Private',
    recipientUser,
    distanceKm: null,
  };
}

// `recipient` join nests the marked user so PostDetail can render the
// "delivered to X" / "given by X" labels with a profile link without a
// second round-trip.
export const POST_SELECT_OWNER = `
  *,
  city_ref:cities!posts_city_fkey(name_he),
  media_assets(*),
  recipient:recipients(
    *,
    user:users!recipients_recipient_user_id_fkey(user_id, display_name, avatar_url, share_handle)
  ),
  owner:users!posts_owner_id_fkey(user_id, display_name, avatar_url, share_handle, privacy_mode)
`;

export const POST_SELECT_BARE = `
  *,
  city_ref:cities!posts_city_fkey(name_he),
  media_assets(*),
  recipient:recipients(*)
`;
