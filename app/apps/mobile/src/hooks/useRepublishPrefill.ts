// Mapped to spec: D127 (docs/spec/90_decisions_log.md) — `/create?republishFrom=<listingId>` opens
// the create form as a republish of the owner's expired listing-world post: on the source's world
// and request / offer, with its title and description. The listing form fills in the rest (minus
// the dates) from the same id and publishes a NEW post; the expired one stays as history.
import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { marketplaceRepository } from '../services/marketplaceComposition';
import type { CreateCategoryId, CreateDirection } from '../lib/unifiedCreate/createCategories';
import { republishTargetFor, type RepublishTarget } from '../lib/unifiedCreate/listingRepublish';

interface Args {
  readonly ownerId: string | null | undefined;
  /** The remembered create choice is loaded; opening the source's world earlier would be overwritten. */
  readonly ready: boolean;
  readonly activeCategoryId: CreateCategoryId;
  readonly selectCategory: (id: CreateCategoryId, direction?: CreateDirection) => void;
  readonly setTitle: (title: string) => void;
  readonly setDescription: (description: string) => void;
}

/** Expo Router may hand a repeated query key over as an array; keep the first value. */
function firstParam(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export function useRepublishPrefill({ ownerId, ready, activeCategoryId, selectCategory, setTitle, setDescription }: Args) {
  const params = useLocalSearchParams<{ republishFrom?: string | string[] }>();
  const sourceId = firstParam(params.republishFrom);
  // Same key and fetch as the listing form's source, so the listing loads once.
  const sourceQuery = useQuery({
    queryKey: ['marketplace', 'detail', sourceId],
    queryFn: () => marketplaceRepository().getListingDetail(sourceId!),
    enabled: Boolean(sourceId && ownerId),
    staleTime: 60_000,
  });
  // The source applied to the form (once per source), with the category it opened.
  const [applied, setApplied] = useState<{ listingId: string; target: RepublishTarget } | null>(null);

  useEffect(() => {
    const detail = sourceQuery.data;
    if (!ready || !detail || applied?.listingId === detail.listingId) return;
    // Someone else's post, or a world without a listing form, opens the plain form.
    const target = republishTargetFor(detail, ownerId);
    if (!target) return;
    selectCategory(target.categoryId, target.direction);
    setTitle(detail.title);
    setDescription(detail.summary ?? '');
    setApplied({ listingId: detail.listingId, target });
  }, [ready, sourceQuery.data, applied, ownerId, selectCategory, setTitle, setDescription]);

  // Loaded and republishable, but not applied yet (the effect above runs after this render).
  const detail = sourceQuery.data;
  const awaitingApply = Boolean(detail && applied?.listingId !== detail.listingId && republishTargetFor(detail, ownerId));
  return {
    /** The source is loading; the form waits so it does not flash the remembered category. */
    loading: (Boolean(sourceId && ownerId) && sourceQuery.isLoading) || awaitingApply,
    /** Passed to the listing form only while the member stays on the source's world. */
    republishFromListingId: applied && applied.target.categoryId === activeCategoryId ? applied.listingId : null,
  };
}
