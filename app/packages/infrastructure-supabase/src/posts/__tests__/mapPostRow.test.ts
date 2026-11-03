import { describe, it, expect } from 'vitest';
import {
  mapPostRow,
  mapPostWithOwnerRow,
  type PostJoinedRow,
  type PostWithOwnerJoinedRow,
} from '../mapPostRow';

// Minimal valid PostRow shape — only the fields the mapper reads. Cast through
// `unknown` to bypass the strict Database.Row interface; the mapper itself
// guards against null/undefined where it matters.
function makeRow(overrides: Partial<PostJoinedRow> = {}): PostJoinedRow {
  return {
    post_id: 'p_1',
    owner_id: 'u_1',
    type: 'Give',
    status: 'open',
    visibility: 'Public',
    title: 'A title',
    description: 'A description',
    category: 'Furniture',
    city: 'IL-001',
    street: null,
    street_number: null,
    location_display_level: 'CityOnly',
    item_condition: 'Good',
    urgency: 'Normal',
    reopen_count: 0,
    delete_after: null,
    created_at: '2026-05-16T12:00:00.000Z',
    updated_at: '2026-05-16T12:00:00.000Z',
    ...overrides,
  } as unknown as PostJoinedRow;
}

describe('mapPostRow (TD-50)', () => {
  it('maps the basic shape with no joins', () => {
    const out = mapPostRow(makeRow());
    expect(out.postId).toBe('p_1');
    expect(out.ownerId).toBe('u_1');
    expect(out.type).toBe('Give');
    expect(out.title).toBe('A title');
    expect(out.address.city).toBe('IL-001');
    expect(out.address.cityName).toBe('IL-001'); // falls back to city when city_ref missing
    expect(out.mediaAssets).toEqual([]);
    expect(out.recipient).toBeNull();
  });

  it('maps estimated_value → estimatedValue, defaulting null (FR-KARMA-004)', () => {
    expect(mapPostRow(makeRow({ estimated_value: 250 })).estimatedValue).toBe(250);
    expect(mapPostRow(makeRow()).estimatedValue).toBeNull();
  });

  it('maps source_language → sourceLanguage when present (FR-TRANSLATE)', () => {
    expect(mapPostRow(makeRow({ source_language: 'en' })).sourceLanguage).toBe('en');
  });

  it('defaults sourceLanguage to null when source_language is absent (FR-TRANSLATE)', () => {
    expect(mapPostRow(makeRow()).sourceLanguage).toBeNull();
  });

  it('maps listing_id → listingId for a feed mirror, null for a plain post (D-206)', () => {
    expect(mapPostRow(makeRow({ listing_id: 'l_1' })).listingId).toBe('l_1');
    expect(mapPostRow(makeRow()).listingId).toBeNull();
  });

  it('maps listing_world_slug → listingWorldSlug, null when absent (FR-FEED-020)', () => {
    expect(mapPostRow(makeRow({ listing_id: 'l_1', listing_world_slug: 'rides' })).listingWorldSlug).toBe('rides');
    expect(mapPostRow(makeRow()).listingWorldSlug).toBeNull();
  });

  it('maps each media asset bucket, defaulting to post-images (D-206)', () => {
    const row = makeRow({
      media_assets: [
        { media_asset_id: 'm_2', post_id: 'p_1', ordinal: 1, path: 'u/b/1.jpg', mime_type: 'image/jpeg', size_bytes: 10, created_at: 'x', bucket: 'listing-images' },
        { media_asset_id: 'm_1', post_id: 'p_1', ordinal: 0, path: 'u/b/0.jpg', mime_type: 'image/jpeg', size_bytes: 10, created_at: 'x', bucket: 'post-images' },
      ] as unknown as PostJoinedRow['media_assets'],
    });
    expect(mapPostRow(row).mediaAssets.map((m) => [m.path, m.bucket])).toEqual([
      ['u/b/0.jpg', 'post-images'],
      ['u/b/1.jpg', 'listing-images'],
    ]);
  });

  it('uses city_ref.name_he when present', () => {
    const out = mapPostRow(makeRow({ city_ref: { name_he: 'תל אביב' } }));
    expect(out.address.cityName).toBe('תל אביב');
  });

  it('sorts media_assets by ordinal ascending', () => {
    const out = mapPostRow(
      makeRow({
        media_assets: [
          {
            media_asset_id: 'm_3',
            post_id: 'p_1',
            path: '/c',
            mime_type: 'image/jpeg',
            size_bytes: 30,
            ordinal: 3,
            created_at: '2026-05-16T12:00:00.000Z',
          },
          {
            media_asset_id: 'm_1',
            post_id: 'p_1',
            path: '/a',
            mime_type: 'image/jpeg',
            size_bytes: 10,
            ordinal: 1,
            created_at: '2026-05-16T12:00:00.000Z',
          },
          {
            media_asset_id: 'm_2',
            post_id: 'p_1',
            path: '/b',
            mime_type: 'image/jpeg',
            size_bytes: 20,
            ordinal: 2,
            created_at: '2026-05-16T12:00:00.000Z',
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    );
    expect(out.mediaAssets.map((m) => m.mediaAssetId)).toEqual(['m_1', 'm_2', 'm_3']);
  });

  it('maps populated recipient join (without user)', () => {
    const out = mapPostRow(
      makeRow({
        recipient: {
          post_id: 'p_1',
          recipient_user_id: 'u_2',
          marked_at: '2026-05-15T10:00:00.000Z',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }),
    );
    expect(out.recipient).toEqual({
      postId: 'p_1',
      recipientUserId: 'u_2',
      markedAt: '2026-05-15T10:00:00.000Z',
    });
  });
});

describe('mapPostWithOwnerRow (TD-50)', () => {
  function makeOwnerRow(overrides: Partial<PostWithOwnerJoinedRow> = {}): PostWithOwnerJoinedRow {
    return {
      ...makeRow(),
      owner: {
        user_id: 'u_1',
        display_name: 'אבי',
        avatar_url: 'https://cdn.example.com/a.jpg',
        share_handle: 'avi',
        privacy_mode: 'Public',
      },
      ...overrides,
    } as PostWithOwnerJoinedRow;
  }

  it('maps populated owner', () => {
    const out = mapPostWithOwnerRow(makeOwnerRow());
    expect(out.ownerName).toBe('אבי');
    expect(out.ownerHandle).toBe('avi');
    expect(out.ownerAvatarUrl).toBe('https://cdn.example.com/a.jpg');
    expect(out.ownerPrivacyMode).toBe('Public');
    expect(out.recipientUser).toBeNull();
    expect(out.distanceKm).toBeNull();
  });

  it('returns ownerName: null when owner is null (orphan FK); UI renders placeholder', () => {
    const out = mapPostWithOwnerRow(makeOwnerRow({ owner: null }));
    expect(out.ownerName).toBeNull();
    expect(out.ownerAvatarUrl).toBeNull();
    expect(out.ownerHandle).toBe('');
    expect(out.ownerPrivacyMode).toBe('Public');
  });

  it('maps populated recipientUser when the recipient join has a user', () => {
    const out = mapPostWithOwnerRow(
      makeOwnerRow({
        recipient: {
          post_id: 'p_1',
          recipient_user_id: 'u_9',
          marked_at: '2026-05-15T10:00:00.000Z',
          user: {
            user_id: 'u_9',
            display_name: 'דנה',
            share_handle: 'dana',
            avatar_url: null,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }),
    );
    expect(out.recipientUser).toEqual({
      userId: 'u_9',
      displayName: 'דנה',
      shareHandle: 'dana',
      avatarUrl: null,
    });
  });

  it('recipientUser is null when recipient join exists but user is missing', () => {
    const out = mapPostWithOwnerRow(
      makeOwnerRow({
        recipient: {
          post_id: 'p_1',
          recipient_user_id: 'u_9',
          marked_at: '2026-05-15T10:00:00.000Z',
          user: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      }),
    );
    expect(out.recipientUser).toBeNull();
  });
});
