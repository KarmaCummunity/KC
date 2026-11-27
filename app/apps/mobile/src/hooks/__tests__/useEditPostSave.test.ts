// FR-POST-008 / FR-POST-009 (#1752): the patch an edit saves. Condition belongs to an offer and
// urgency to a request; empty text is stored as null; a missing city is refused before any call.
import { describe, expect, it, vi } from 'vitest';

// Only the pure patch builder is under test; keep the composition root and router out of it.
vi.mock('../../services/postsComposition', () => ({ getUpdatePostUseCase: vi.fn() }));
vi.mock('../../services/postMessages', () => ({ mapPostErrorToHebrew: vi.fn() }));
vi.mock('../../lib/syncOwnerPostActorIdentity', () => ({ syncOwnerPostActorIdentity: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: vi.fn() }));

import { buildEditPostPatch } from '../useEditPostSave';
import type { EditPostForm } from '../useEditPostForm';

const FORM = {
  title: 'Sofa',
  description: '  comfy  ',
  category: 'Furniture',
  condition: 'LikeNew',
  urgency: '  today ',
  city: { id: 'IL-1', name: 'Lod' },
  street: 'Main',
  streetNumber: '12',
  locationDisplayLevel: 'CityOnly',
  visibility: 'Public',
  uploads: [{ path: 'u/a.jpg', mimeType: 'image/jpeg', sizeBytes: 10, previewUri: 'x' }],
} as unknown as EditPostForm;

describe('buildEditPostPatch', () => {
  it('builds an offer patch: condition kept, urgency cleared, text trimmed, photos without previews', () => {
    expect(buildEditPostPatch(FORM, true)).toEqual({
      title: 'Sofa',
      description: 'comfy',
      category: 'Furniture',
      address: { city: 'IL-1', cityName: 'Lod', street: 'Main', streetNumber: '12' },
      locationDisplayLevel: 'CityOnly',
      itemCondition: 'LikeNew',
      urgency: null,
      visibility: 'Public',
      mediaAssets: [{ path: 'u/a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
    });
  });

  it('builds a request patch: urgency kept and trimmed, condition cleared, blank description null', () => {
    const patch = buildEditPostPatch({ ...FORM, description: '   ' } as EditPostForm, false);
    expect(patch).toMatchObject({ itemCondition: null, urgency: 'today', description: null });
  });

  it('refuses a form without a city', () => {
    expect(() => buildEditPostPatch({ ...FORM, city: null } as EditPostForm, true)).toThrow('city_required');
  });
});
