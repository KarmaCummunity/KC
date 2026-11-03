import { describe, expect, it } from 'vitest';
import { mapListingDetail } from '../mapListingDetail';

describe('mapListingDetail', () => {
  it('maps rpc json', () => {
    const out = mapListingDetail({
      listing_id: 'l1',
      owner_id: 'u1',
      world_slug: 'items',
      world_label_en: 'Items',
      world_label_he: 'חפצים',
      kind_slug: 'give_item',
      kind_label_en: 'Give',
      kind_label_he: 'מסירה',
      direction: 'give',
      title: 'Chair',
      summary: null,
      details: { item_condition: 'Good' },
      city_id: '5000',
      urgency_level: 2,
      availability_status: 'ongoing',
      published_at: '2026-01-01T00:00:00Z',
      geo: { type: 'Point', coordinates: [34.78, 32.08] },
      max_radius_km: 25,
      media: [{ storage_path: 'u/b/0.jpg', sort_order: 0 }],
      owner: { user_id: 'u1', display_name: 'Ada', avatar_url: null, share_handle: 'ada', city_id: '5000' },
    });
    expect(out?.listingId).toBe('l1');
    expect(out?.lat).toBe(32.08);
    expect(out?.media).toHaveLength(1);
    expect(out?.feedPostId).toBeNull();
  });

  it('maps the feed mirror post id when the listing has one (D-206)', () => {
    const out = mapListingDetail({
      listing_id: 'l1',
      owner_id: 'u1',
      world_slug: 'food',
      kind_slug: 'give_food',
      direction: 'give',
      title: 'Bread',
      details: {},
      feed_post_id: 'p_mirror',
    });
    expect(out?.feedPostId).toBe('p_mirror');
  });
});
