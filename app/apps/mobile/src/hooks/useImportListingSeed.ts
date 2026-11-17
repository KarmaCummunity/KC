// Mapped to spec: FR-IMPORT-007 AC1 — the world forms (rides, food, housing, time) seed their own
// fields from an import draft: the kind of the direction the text named, the world sub-category
// it matched and a clearly matched city. The basics (world, direction, title, description) were
// already applied by useImportPrefill; this runs once, after the world's kinds are loaded.
import { useEffect, useRef } from 'react';
import type { ImportDraft, ListingKindOption } from '@kc/domain';
import { importSeedFromDraft } from '../lib/unifiedCreate/importSeed';
import { WORLDS_WITH_SUBCATEGORY_PICKER } from '../lib/unifiedCreate/createCategories';
import { marketplaceRepository } from '../services/marketplaceComposition';
import { useImportDraftStore } from '../store/importDraftStore';

interface Args {
  readonly worldSlug: string;
  /** The world's kinds; undefined while they load. */
  readonly kinds: readonly ListingKindOption[] | undefined;
  /** False on an edit or a republish: those forms start from their source, never from an import. */
  readonly enabled: boolean;
  readonly chooseKind: (slug: string | null) => void;
  readonly setSubcategoryId: (id: string | null) => void;
  readonly setCity: (city: { id: string; name: string } | null) => void;
}

/** The world's sub-categories, for the worlds that pick one; empty for the others. */
async function subcategoriesFor(worldSlug: string) {
  if (!WORLDS_WITH_SUBCATEGORY_PICKER.includes(worldSlug)) return [];
  try {
    return await marketplaceRepository().listWorldSubcategories(worldSlug);
  } catch {
    // Without the list the sub-category stays for the member to pick; the rest still applies.
    return [];
  }
}

export function useImportListingSeed({ worldSlug, kinds, enabled, chooseKind, setSubcategoryId, setCity }: Args): void {
  const started = useRef(false);
  // The setters are read through a ref: the form recreates some of them every render, and a
  // re-run of the effect would cancel the pending seed.
  const setters = useRef({ chooseKind, setSubcategoryId, setCity });
  setters.current = { chooseKind, setSubcategoryId, setCity };
  // Only unmounting cancels the seed; a refetch of the kinds must not drop it half way.
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  useEffect(() => {
    if (!enabled || !kinds || started.current) return;
    started.current = true;
    const draft: ImportDraft | null = useImportDraftStore.getState().takeSeededDraft();
    // A draft of another world belongs to the items form (or nothing): this form leaves it.
    if (!draft || draft.extraction?.worldSlug !== worldSlug) return;
    void subcategoriesFor(worldSlug).then((subcategories) => {
      if (!mounted.current) return;
      const seed = importSeedFromDraft(draft, { kinds, subcategories });
      if (!seed) return;
      const apply = setters.current;
      if (seed.kindSlug) apply.chooseKind(seed.kindSlug);
      if (seed.worldSubcategoryId) apply.setSubcategoryId(seed.worldSubcategoryId);
      // A ride is placed by its route, never by a city.
      if (seed.city && worldSlug !== 'rides') apply.setCity(seed.city);
    });
  }, [enabled, kinds, worldSlug]);
}
