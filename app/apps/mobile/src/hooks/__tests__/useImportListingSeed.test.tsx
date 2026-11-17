// @vitest-environment jsdom
// FR-IMPORT-007 AC1 — a world form opened from an import starts on the kind of the direction the
// text named, the sub-category it matched and a clearly matched city; once, and only for its world.
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manualImportDraft, type ExtractedPost, type ImportDraft, type ListingKindOption } from '@kc/domain';

const listWorldSubcategories = vi.hoisted(() => vi.fn());
vi.mock('../../services/marketplaceComposition', () => ({ marketplaceRepository: () => ({ listWorldSubcategories }) }));

import { useImportDraftStore } from '../../store/importDraftStore';
import { useImportListingSeed } from '../useImportListingSeed';

const kind = (slug: string, direction: ListingKindOption['direction']): ListingKindOption =>
  ({ kindId: `k-${slug}`, slug, labelEn: slug, labelHe: slug, direction, detailSchema: {} });
const FOOD_KINDS = [kind('food_offer', 'give'), kind('food_request', 'request')];

const extraction = (over: Partial<ExtractedPost> = {}): ExtractedPost => ({
  isPost: true, rejectReason: null, direction: 'offer', worldSlug: 'food', subcategory: 'bakery', title: 'Bread', description: 'Fresh',
  place: { cityText: 'haifa', streetText: null, neighborhoodText: null },
  time: { kind: 'none', dayOffset: null, weekday: null, month: null, dayOfMonth: null, timeHhmm: null, timePeriod: null, recurringWeekdays: [] },
  ride: null, details: {}, language: 'he', confidence: { overall: 0.9, perField: {} }, ...over,
});
const CITY = { status: 'picked' as const, picked: { level: 'city' as const, placeId: 'c1', nameHe: 'Haifa', cityId: null, score: 0.95, margin: 0.3 }, suggestions: [] };
const draft = (over: Partial<ExtractedPost> = {}): ImportDraft => ({ ...manualImportDraft('ok'), routing: 'confirm', extraction: extraction(over), city: CITY });

function seedDraft(d: ImportDraft) {
  useImportDraftStore.getState().hold(d, 'text');
  useImportDraftStore.getState().take();
}

function setup(over: { worldSlug?: string; kinds?: ListingKindOption[] | undefined; enabled?: boolean } = {}) {
  const fns = { chooseKind: vi.fn(), setSubcategoryId: vi.fn(), setCity: vi.fn() };
  const initialProps = { worldSlug: over.worldSlug ?? 'food', kinds: 'kinds' in over ? over.kinds : FOOD_KINDS, enabled: over.enabled ?? true };
  const view = renderHook((p: typeof initialProps) => useImportListingSeed({ ...p, ...fns }), { initialProps });
  return { fns, ...view };
}

describe('useImportListingSeed', () => {
  beforeEach(() => {
    useImportDraftStore.setState({ held: null, pendingImportId: null, seededDraft: null, review: null, seededFields: {} });
    listWorldSubcategories.mockReset();
    listWorldSubcategories.mockResolvedValue([{ categoryId: 'sub-bakery', slug: 'bakery', labelHe: 'b', labelEn: null }]);
  });

  it('seeds the kind, the sub-category and the picked city of its own world', async () => {
    seedDraft(draft());
    const { fns } = setup();
    await waitFor(() => expect(fns.setCity).toHaveBeenCalledWith({ id: 'c1', name: 'Haifa' }));
    expect(fns.chooseKind).toHaveBeenCalledWith('food_offer');
    expect(fns.setSubcategoryId).toHaveBeenCalledWith('sub-bakery');
    expect(useImportDraftStore.getState().seededDraft).toBeNull();
    // FR-IMPORT-010 AC4: the world form notes its own seeded fields.
    expect(useImportDraftStore.getState().seededFields).toEqual({ kind: 'food_offer', subcategory: 'sub-bakery', city: 'c1' });
  });

  it('waits for the kinds, then seeds once', async () => {
    seedDraft(draft());
    const { fns, rerender } = setup({ kinds: undefined });
    expect(fns.chooseKind).not.toHaveBeenCalled();
    rerender({ worldSlug: 'food', kinds: FOOD_KINDS, enabled: true });
    rerender({ worldSlug: 'food', kinds: [...FOOD_KINDS], enabled: true });
    await waitFor(() => expect(fns.chooseKind).toHaveBeenCalledTimes(1));
  });

  it('leaves a draft of another world alone', async () => {
    seedDraft(draft({ worldSlug: 'items' }));
    const { fns } = setup();
    await Promise.resolve();
    expect(fns.chooseKind).not.toHaveBeenCalled();
    expect(listWorldSubcategories).not.toHaveBeenCalled();
  });

  it('an edit or a republish never takes the import', () => {
    seedDraft(draft());
    const { fns } = setup({ enabled: false });
    expect(fns.chooseKind).not.toHaveBeenCalled();
    expect(useImportDraftStore.getState().seededDraft).not.toBeNull();
  });

  it('a failed sub-category lookup still seeds the kind and the city', async () => {
    listWorldSubcategories.mockRejectedValue(new Error('offline'));
    seedDraft(draft());
    const { fns } = setup();
    await waitFor(() => expect(fns.setCity).toHaveBeenCalled());
    expect(fns.setSubcategoryId).not.toHaveBeenCalled();
  });

  it('a ride is placed by its route, never by a city', async () => {
    seedDraft(draft({ worldSlug: 'rides', subcategory: null }));
    const { fns } = setup({ worldSlug: 'rides', kinds: [kind('ride_offer', 'give'), kind('ride_request', 'request')] });
    await waitFor(() => expect(fns.chooseKind).toHaveBeenCalledWith('ride_offer'));
    expect(fns.setCity).not.toHaveBeenCalled();
    expect(useImportDraftStore.getState().seededFields).not.toHaveProperty('city');
  });

  it('nothing seeded means nothing happens', async () => {
    const { fns } = setup();
    await Promise.resolve();
    expect(fns.chooseKind).not.toHaveBeenCalled();
  });
});
