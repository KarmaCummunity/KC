// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCreatePostFormState } from '../useCreatePostFormState';
import type { HydratedDraft } from '../usePostDraftHydration';

describe('useCreatePostFormState', () => {
  it('starts with canonical defaults and updates public setters', () => {
    const { result } = renderHook(() => useCreatePostFormState());
    expect(result.current.type).toBe('Give');
    expect(result.current.title).toBe('');
    expect(result.current.description).toBe('');
    expect(result.current.category).toBe('Other');
    expect(result.current.condition).toBe('Good');
    expect(result.current.urgency).toBe('');
    expect(result.current.estimatedValue).toBe(0);
    expect(result.current.locationDisplayLevel).toBe('CityAndStreet');
    expect(result.current.visibility).toBe('Public');
    expect(result.current.hideFromCounterparty).toBe(false);
    expect(result.current.uploads).toEqual([]);

    act(() => {
      result.current.setTitle('A useful item');
      result.current.setVisibility('OnlyMe');
    });
    expect(result.current.title).toBe('A useful item');
    expect(result.current.visibility).toBe('OnlyMe');
    expect(result.current.visibilityRef.current).toBe('OnlyMe');
  });

  it('applies a hydrated draft and strips image availability metadata', () => {
    const { result } = renderHook(() => useCreatePostFormState());
    const draft = {
      ownerId: 'user-1', updatedAt: 10, type: 'Request', title: 'Need a chair',
      description: 'Any condition', category: 'Furniture', condition: 'Fair',
      urgency: 'Soon', estimatedValue: 25, locationDisplayLevel: 'CityOnly',
      visibility: 'OnlyMe', hideFromCounterparty: true,
      uploads: [{ path: 'images/chair.jpg', mimeType: 'image/jpeg', sizeBytes: 100, previewUri: 'file://chair', missing: true }],
      missingCount: 1,
    } as unknown as HydratedDraft;

    act(() => result.current.applyDraft(draft));
    expect(result.current).toMatchObject({
      type: 'Request', title: 'Need a chair', description: 'Any condition',
      category: 'Furniture', condition: 'Fair', urgency: 'Soon', estimatedValue: 25,
      locationDisplayLevel: 'CityOnly', visibility: 'OnlyMe', hideFromCounterparty: true,
    });
    expect(result.current.uploads).toEqual([
      { path: 'images/chair.jpg', mimeType: 'image/jpeg', sizeBytes: 100, previewUri: 'file://chair' },
    ]);
    expect(result.current.visibilityRef.current).toBe('OnlyMe');
  });

  it('uses zero when a restored draft has no estimated value', () => {
    const { result } = renderHook(() => useCreatePostFormState());
    const draft = {
      type: 'Give', title: '', description: '', category: 'Other', condition: 'Good',
      urgency: '', locationDisplayLevel: 'CityAndStreet', visibility: 'Public',
      hideFromCounterparty: false, uploads: [],
    } as unknown as HydratedDraft;
    act(() => result.current.applyDraft(draft));
    expect(result.current.estimatedValue).toBe(0);
  });
});
