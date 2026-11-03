import { describe, expect, it, vi } from 'vitest';
import type { Post } from '@kc/domain';

vi.mock('../analyticsCoreLoop', () => ({
  trackCoreLoop: vi.fn(),
}));

const basePost: Post = {
  postId: 'p1',
  ownerId: 'u1',
  type: 'Give',
  status: 'closed_delivered',
  statusBeforeAdminRemoval: null,
  visibility: 'Public',
  title: 't',
  description: null,
  category: 'Other',
  address: { city: 'lod', cityName: 'Lod', street: 's', streetNumber: '1' },
  locationDisplayLevel: 'CityOnly',
  itemCondition: null,
  urgency: null,
  estimatedValue: null,
  mediaAssets: [],
  recipient: null,
  reopenCount: 0,
  listingId: null,
  listingWorldSlug: null,
  deleteAfter: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  sourceLanguage: null,
};

describe('trackSocialHandoverCompleted', () => {
  it('emits handover_completed with social world and city slug', async () => {
    const { trackCoreLoop } = await import('../analyticsCoreLoop');
    const { trackSocialHandoverCompleted } = await import('../trackSocialHandoverCompleted');

    trackSocialHandoverCompleted(basePost);

    expect(trackCoreLoop).toHaveBeenCalledWith('handover_completed', {
      world: 'social',
      cityId: 'lod',
      postId: 'p1',
    });
  });
});
