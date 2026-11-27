// @vitest-environment jsdom
// FR-POST-008 / FR-POST-009 (#1752): the edit form seeds every field from the loaded post once,
// keeps the member's edits when the post object changes, and seeds again for another post id.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Post } from '@kc/domain';

// Image URLs need the Supabase env; the tile URL shape is not what these tests pin.
vi.mock('../../lib/imageUrl', () => ({
  getSupabaseImageThumbUrl: ({ path }: { path: string }) => `thumb:${path}`,
  getSupabasePublicImageUrl: ({ path }: { path: string }) => `original:${path}`,
}));

import { useEditPostForm } from '../useEditPostForm';

function post(overrides: Partial<Post> = {}): Post {
  return {
    postId: 'p1',
    title: 'Sofa',
    description: null,
    category: 'Furniture',
    itemCondition: null,
    urgency: 'today',
    address: { city: 'IL-1', cityName: 'Lod', street: 'Main', streetNumber: '12' },
    locationDisplayLevel: 'CityOnly',
    visibility: 'FollowersOnly',
    mediaAssets: [{ path: 'u/a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
    ...overrides,
  } as Post;
}

describe('useEditPostForm', () => {
  it('stays unseeded until the post loads, then seeds every field from it', () => {
    const { result, rerender } = renderHook(({ p }) => useEditPostForm('p1', p), {
      initialProps: { p: undefined as Post | undefined },
    });
    expect(result.current.seeded).toBe(false);

    rerender({ p: post() });
    expect(result.current).toMatchObject({
      seeded: true,
      title: 'Sofa',
      description: '',
      category: 'Furniture',
      condition: 'Good',
      urgency: 'today',
      city: { id: 'IL-1', name: 'Lod' },
      street: 'Main',
      streetNumber: '12',
      locationDisplayLevel: 'CityOnly',
      visibility: 'FollowersOnly',
    });
    expect(result.current.uploads).toEqual([
      { path: 'u/a.jpg', mimeType: 'image/jpeg', sizeBytes: 10, previewUri: 'thumb:u/a.jpg', previewFallbackUri: 'original:u/a.jpg' },
    ]);
  });

  it('keeps the member edits when the same post is refetched', () => {
    const { result, rerender } = renderHook(({ p }) => useEditPostForm('p1', p), { initialProps: { p: post() } });
    act(() => result.current.setTitle('Blue sofa'));
    rerender({ p: post({ title: 'Server title' }) });
    expect(result.current.title).toBe('Blue sofa');
  });

  it('seeds again for another post id', () => {
    const { result, rerender } = renderHook(({ id, p }) => useEditPostForm(id, p), {
      initialProps: { id: 'p1', p: post() },
    });
    act(() => result.current.setTitle('edited'));
    rerender({ id: 'p2', p: post({ postId: 'p2', title: 'Table' }) });
    expect(result.current.title).toBe('Table');
  });
});
