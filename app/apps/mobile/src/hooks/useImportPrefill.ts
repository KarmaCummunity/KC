// Mapped to spec: FR-IMPORT-006 AC2, FR-IMPORT-007 AC1 — `/create?importDraft=1` opens the create
// form on the world and request / offer the extraction found, with its title and description. A
// draft the extraction could not use (the manual route) leaves the form on its own category with
// the pasted text in the description, so nothing the member pasted is lost.
import { useEffect, useRef } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useImportDraftStore } from '../store/importDraftStore';
import { importSeedFromDraft } from '../lib/unifiedCreate/importSeed';
import type { CreateCategoryId, CreateDirection } from '../lib/unifiedCreate/createCategories';

interface Args {
  /** The remembered create choice is loaded; opening the world earlier would be overwritten. */
  readonly ready: boolean;
  readonly selectCategory: (id: CreateCategoryId, direction?: CreateDirection) => void;
  readonly setTitle: (title: string) => void;
  readonly setDescription: (description: string) => void;
  /** The items form's city; the world forms seed their own city (useImportListingSeed). */
  readonly setCity: (city: { id: string; name: string }) => void;
}

/** Expo Router may hand a repeated query key over as an array; keep the first value. */
function firstParam(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** The kinds and sub-categories are loaded by the listing form itself; here only the basics are needed. */
const NO_LOOKUPS = { kinds: [], subcategories: [] } as const;

export function useImportPrefill({ ready, selectCategory, setTitle, setDescription, setCity }: Args): void {
  const params = useLocalSearchParams<{ importDraft?: string | string[] }>();
  const requested = firstParam(params.importDraft) === '1';
  const applied = useRef(false);

  useEffect(() => {
    if (!requested || !ready || applied.current) return;
    applied.current = true;
    const held = useImportDraftStore.getState().take();
    if (!held) return;
    const seed = importSeedFromDraft(held.draft, NO_LOOKUPS);
    if (!seed) {
      setDescription(held.pastedText);
      return;
    }
    selectCategory(seed.categoryId, seed.direction ?? undefined);
    setTitle(seed.title);
    setDescription(seed.description);
    // Only a city the catalog matched clearly; setting it also stops the last-address prefill.
    if (seed.city) setCity(seed.city);
  }, [requested, ready, selectCategory, setTitle, setDescription, setCity]);

  // Closing the form drops the import: a later post must never be seeded or marked from it.
  useEffect(() => () => useImportDraftStore.getState().forget(), []);
}
