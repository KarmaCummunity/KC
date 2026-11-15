import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { mapCardToPost, mapCardToPostWithOwner, mapMediaRow, detailNumber, detailString } from '../mapPostRow';
import { loadPostCatalog } from '../postCatalog';
import { KIND_ROWS, SUBCATEGORY_ROWS, makeCard, ok } from './cardFixtures';

async function catalog() {
  const { client } = createFakeClient({
    tables: { item_subcategories: ok(SUBCATEGORY_ROWS), post_kinds: ok(KIND_ROWS) },
  });
  return loadPostCatalog(client);
}

describe('mapCardToPost', () => {
  it('maps the card of an item offer to the domain post', async () => {
    const post = mapCardToPost(makeCard(), { catalog: await catalog() });

    expect(post).toMatchObject({
      postId: 'post-1',
      ownerId: 'owner-1',
      type: 'Give',
      status: 'open',
      visibility: 'Public',
      title: 'Sofa',
      description: 'Three seats',
      category: 'Furniture',
      itemCondition: 'Good',
      estimatedValue: 120,
      urgency: null,
      locationDisplayLevel: 'CityAndStreet',
      listingId: null,
      listingWorldSlug: null,
      reopenCount: 0,
    });
    expect(post.address).toEqual({ city: 'IL-001', cityName: 'Tel Aviv', street: '', streetNumber: '' });
    expect(post.mediaAssets).toEqual([
      expect.objectContaining({ mediaAssetId: 'm1', bucket: 'post-images', path: 'owner-1/b/0.jpg' }),
    ]);
  });

  it('maps a request, an unknown subcategory and an urgency note', async () => {
    const card = makeCard({
      direction: 'request',
      item_subcategory_id: 'sub-unknown',
      details: { urgency_note: 'by Friday' },
      cover_media: null,
    });

    const post = mapCardToPost(card, { catalog: await catalog() });

    expect(post.type).toBe('Request');
    expect(post.category).toBe('Other');
    expect(post.urgency).toBe('by Friday');
    expect(post.itemCondition).toBeNull();
    expect(post.mediaAssets).toEqual([]);
  });

  it('ignores a condition that is not one of the known values', async () => {
    const post = mapCardToPost(makeCard({ details: { item_condition: 'Mint' } }), { catalog: await catalog() });
    expect(post.itemCondition).toBeNull();
  });

  it('treats a post of another world as a listing of that world', async () => {
    const post = mapCardToPost(makeCard({ id: 'ride-1', world_slug: 'rides', post_type: 'ride' }), {
      catalog: await catalog(),
    });

    expect(post.listingId).toBe('ride-1');
    expect(post.listingWorldSlug).toBe('rides');
  });

  it('takes the street from the owner-only location, and the extras from the page', async () => {
    const post = mapCardToPost(makeCard({ status: 'deleted_no_recipient' }), {
      catalog: await catalog(),
      street: { street: 'Herzl', streetNumber: '5' },
      extras: {
        geo: null,
        sourceLanguage: 'he',
        statusBeforeRemoval: null,
        challengeId: 'ch-1',
        purgeAfter: '2026-02-01T00:00:00Z',
        recipient: null,
      },
    });

    expect(post.address).toMatchObject({ street: 'Herzl', streetNumber: '5' });
    expect(post).toMatchObject({ sourceLanguage: 'he', challengeId: 'ch-1', deleteAfter: '2026-02-01T00:00:00Z' });
  });

  it('gives another member the street the poster chose to show (0029); the owner\'s own address wins', async () => {
    const extras = {
      geo: null, sourceLanguage: null, statusBeforeRemoval: null, challengeId: null, purgeAfter: null, recipient: null,
      shownStreet: 'Herzl', shownStreetNumber: null,
    };
    const shown = mapCardToPost(makeCard(), { catalog: await catalog(), extras });
    expect(shown.address).toMatchObject({ street: 'Herzl', streetNumber: '' });

    const own = mapCardToPost(makeCard(), {
      catalog: await catalog(),
      extras,
      street: { street: 'Herzl', streetNumber: '5' },
    });
    expect(own.address).toMatchObject({ street: 'Herzl', streetNumber: '5' });
  });

  it('uses the whole gallery when the detail loaded it', async () => {
    const gallery = [
      mapMediaRow({
        id: 'a', post_id: 'post-1', owner_id: 'owner-1', kind: 'image', storage_bucket: 'post-images',
        storage_key: 'owner-1/b/0.jpg', ordinal: 0, mime_type: 'image/jpeg', size_bytes: 10, width: null,
        height: null, duration_ms: null, blurhash: null, processing_status: 'pending', created_at: '2026-01-01T00:00:00Z',
      }),
    ];

    const post = mapCardToPost(makeCard(), { catalog: await catalog(), media: gallery });

    expect(post.mediaAssets).toEqual(gallery);
    expect(post.mediaAssets[0]).toMatchObject({ mimeType: 'image/jpeg', sizeBytes: 10, path: 'owner-1/b/0.jpg' });
  });
});

describe('mapCardToPostWithOwner', () => {
  it('carries the owner shown on the card and the distance in km', async () => {
    const post = mapCardToPostWithOwner(makeCard(), { catalog: await catalog(), distanceM: 2500 });

    expect(post).toMatchObject({
      ownerName: 'Dana',
      ownerHandle: 'dana',
      ownerAvatarUrl: 'https://img/dana.png',
      ownerVerificationLevel: 2,
      ownerProfileNavigableFromPost: true,
      distanceKm: 2.5,
      recipientUser: null,
    });
  });

  it('shows a masked poster as anonymous: no owner fields and no profile link (FR-POST-021)', async () => {
    const masked = makeCard({
      owner_identity_masked: true,
      owner_id: null,
      owner_display_name: null,
      owner_share_handle: null,
      owner_avatar_url: null,
      owner_verification_level: null,
    });

    const post = mapCardToPostWithOwner(masked, { catalog: await catalog() });

    expect(post).toMatchObject({
      ownerId: '',
      ownerName: null,
      ownerHandle: '',
      ownerAvatarUrl: null,
      ownerVerificationLevel: 0,
      ownerProfileNavigableFromPost: false,
      distanceKm: null,
    });
  });
});

describe('details helpers', () => {
  it('read only strings and finite numbers from an object document', () => {
    expect(detailString({ a: 'x', b: '', c: 1 }, 'a')).toBe('x');
    expect(detailString({ b: '' }, 'b')).toBeNull();
    expect(detailString([], 'a')).toBeNull();
    expect(detailNumber({ n: 5 }, 'n')).toBe(5);
    expect(detailNumber({ n: '5' }, 'n')).toBeNull();
    expect(detailNumber(null, 'n')).toBeNull();
  });
});
