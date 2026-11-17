// @vitest-environment jsdom
// FR-IMPORT-007 AC1 / FR-IMPORT-006 AC2 — `/create?importDraft=1` prefills the create form from the
// held draft once; the manual route puts the pasted text into the description.
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manualImportDraft, type ExtractedPost, type ImportDraft } from '@kc/domain';

const mocks = vi.hoisted(() => ({ params: {} as { importDraft?: string | string[] } }));
vi.mock('expo-router', () => ({ useLocalSearchParams: () => mocks.params }));

import { useImportDraftStore } from '../../store/importDraftStore';
import { useImportPrefill } from '../useImportPrefill';

const extraction: ExtractedPost = {
  isPost: true, rejectReason: null, direction: 'offer', worldSlug: 'items', subcategory: 'furniture', title: 'Sofa', description: 'Three seats',
  place: { cityText: null, streetText: null, neighborhoodText: null },
  time: { kind: 'none', dayOffset: null, weekday: null, month: null, dayOfMonth: null, timeHhmm: null, timePeriod: null, recurringWeekdays: [] },
  ride: null, details: {}, language: 'he', confidence: { overall: 0.9, perField: {} },
};
const usable: ImportDraft = { ...manualImportDraft('ok'), routing: 'confirm', extraction };

function setup(over: { ready?: boolean } = {}) {
  const fns = { selectCategory: vi.fn(), setTitle: vi.fn(), setDescription: vi.fn(), setCity: vi.fn() };
  const view = renderHook((p: { ready: boolean }) => useImportPrefill({ ...p, ...fns }), { initialProps: { ready: over.ready ?? true } });
  return { fns, ...view };
}

describe('useImportPrefill', () => {
  beforeEach(() => {
    mocks.params = { importDraft: '1' };
    useImportDraftStore.setState({ held: null, pendingImportId: null, seededDraft: null, review: null });
  });

  it('opens the world, direction, title and description of a usable draft', () => {
    useImportDraftStore.getState().hold(usable, 'pasted');
    const { fns } = setup();
    expect(fns.selectCategory).toHaveBeenCalledWith('items', 'give');
    expect(fns.setTitle).toHaveBeenCalledWith('Sofa');
    expect(fns.setDescription).toHaveBeenCalledWith('Three seats');
  });

  it('an unknown direction opens the world and leaves the direction to the form', () => {
    useImportDraftStore.getState().hold({ ...usable, extraction: { ...extraction, direction: 'unknown' } }, 'pasted');
    const { fns } = setup();
    expect(fns.selectCategory).toHaveBeenCalledWith('items', undefined);
  });

  it('the manual route keeps the form as it is and puts the pasted text in the description', () => {
    useImportDraftStore.getState().hold(manualImportDraft('rate_limited'), 'my pasted text');
    const { fns } = setup();
    expect(fns.selectCategory).not.toHaveBeenCalled();
    expect(fns.setTitle).not.toHaveBeenCalled();
    expect(fns.setDescription).toHaveBeenCalledWith('my pasted text');
  });

  it('waits until the remembered create choice is loaded, then applies once', () => {
    useImportDraftStore.getState().hold(usable, 'pasted');
    const { fns, rerender } = setup({ ready: false });
    expect(fns.selectCategory).not.toHaveBeenCalled();
    rerender({ ready: true });
    rerender({ ready: true });
    expect(fns.selectCategory).toHaveBeenCalledTimes(1);
    expect(useImportDraftStore.getState().held).toBeNull();
  });

  it('does nothing without the parameter, even if a draft is held', () => {
    mocks.params = {};
    useImportDraftStore.getState().hold(usable, 'pasted');
    const { fns } = setup();
    expect(fns.selectCategory).not.toHaveBeenCalled();
    expect(useImportDraftStore.getState().held).not.toBeNull();
  });

  it('reads the first value of a repeated parameter, and nothing held is no change', () => {
    mocks.params = { importDraft: ['1', '0'] };
    const { fns } = setup();
    expect(fns.selectCategory).not.toHaveBeenCalled();
    expect(fns.setDescription).not.toHaveBeenCalled();
  });

  it('seeds a clearly matched city and leaves an unsure one to the member', () => {
    const picked = { status: 'picked' as const, picked: { level: 'city' as const, placeId: 'c1', nameHe: 'Haifa', cityId: null, score: 0.95, margin: 0.3 }, suggestions: [] };
    useImportDraftStore.getState().hold({ ...usable, city: picked }, 'pasted');
    const { fns } = setup();
    expect(fns.setCity).toHaveBeenCalledWith({ id: 'c1', name: 'Haifa' });
  });

  it('a draft with no picked city does not touch the city', () => {
    useImportDraftStore.getState().hold(usable, 'pasted');
    const { fns } = setup();
    expect(fns.setCity).not.toHaveBeenCalled();
  });

  it('closing the form forgets the import, so a later post is not marked from it', () => {
    useImportDraftStore.getState().hold({ ...usable, importId: 'imp-1' }, 'pasted');
    const { unmount } = setup();
    expect(useImportDraftStore.getState().pendingImportId).toBe('imp-1');
    unmount();
    expect(useImportDraftStore.getState().pendingImportId).toBeNull();
    expect(useImportDraftStore.getState().review).toBeNull();
  });
});
