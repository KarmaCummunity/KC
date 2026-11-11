// Fixtures shared by the post adapter tests: a `post_card`, the catalog rows, and the table / RPC
// answers a page of posts needs from the fake client.

import type { FakeClientConfig, FakeResult } from '../../__tests__/fakeBaselineClient';
import type { PostCardRow } from '../mapPostRow';

export const ok = (data: unknown): FakeResult => ({ data, error: null });
export const fail = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

/** Subcategory ids of the items world, as the seed loads them. */
export const SUBCATEGORY_ROWS = [
  { id: 'sub-furniture', slug: 'furniture' },
  { id: 'sub-books', slug: 'books' },
  { id: 'sub-baby', slug: 'baby_gear' },
  { id: 'sub-other', slug: 'other' },
];

export const KIND_ROWS = [
  { id: 'kind-offer', direction: 'offer' },
  { id: 'kind-request', direction: 'request' },
];

/** A visible, unmasked item card; override what a test cares about. */
export function makeCard(overrides: Partial<PostCardRow> = {}): PostCardRow {
  return {
    id: 'post-1',
    owner_id: 'owner-1',
    world_slug: 'items',
    kind_id: 'kind-offer',
    post_type: 'standard',
    direction: 'offer',
    status: 'open',
    visibility: 'Public',
    title: 'Sofa',
    description: 'Three seats',
    item_subcategory_id: 'sub-furniture',
    details: { item_condition: 'Good', estimated_value: 120, urgency_note: null },
    city_id: 'IL-001',
    city_name_he: 'Tel Aviv',
    city_name_en: 'Tel Aviv',
    location_display_level: 'CityAndStreet',
    time_window: null,
    urgency_level: null,
    expires_at: null,
    published_at: '2026-01-02T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    owner_display_name: 'Dana',
    owner_share_handle: 'dana',
    owner_avatar_url: 'https://img/dana.png',
    owner_verification_level: 2,
    cover_media: { id: 'm1', kind: 'image', storage_bucket: 'post-images', storage_key: 'owner-1/b/0.jpg' },
    media_count: 1,
    reactions_count: 3,
    comments_count: 1,
    shares_count: 0,
    viewer_reaction: null,
    viewer_saved: false,
    viewer_follows_owner: false,
    owner_identity_masked: false,
    ...overrides,
  };
}

/** The answers every page of posts needs besides the page call itself. */
export function pageTables(extra: FakeClientConfig['tables'] = {}): NonNullable<FakeClientConfig['tables']> {
  return {
    item_subcategories: ok(SUBCATEGORY_ROWS),
    post_kinds: ok(KIND_ROWS),
    posts: ok([]),
    challenges: ok([]),
    post_closures: ok([]),
    post_handoffs: ok([]),
    users: ok([]),
    ...extra,
  };
}
