// Mapped to spec: FR-POST-001 AC3 (owner edit, G1) + D127 (republish an expired post as a new one).
// The listing the listing form starts from. Edit loads the listing and fills the form with all of
// its details (saved through `updateMyListing`). Republish loads the source the same way but fills
// the form with everything except its dates, keeps its photos, and publishes a NEW listing. Also
// owns the "a new kind starts from its own defaults" reset, because a republish seed has to
// survive the kind switch it causes.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ListingKindOption } from '@kc/domain';
import { marketplaceRepository } from '../services/marketplaceComposition';
import { initialDetailsFor, type ListingFieldSpec } from '../lib/unifiedCreate/listingFieldSpecs';
import { pickRideDetails } from '../lib/unifiedCreate/listingCreateDetails';
import { listingRepublishSeed, type ListingRepublishSeed } from '../lib/unifiedCreate/listingRepublish';
import type { OrgEventChoice } from './useOrgEventChoice';

type City = { id: string; name: string };

interface Args {
  readonly editListingId: string | null;
  readonly republishFromListingId: string | null;
  readonly kind: ListingKindOption | null;
  readonly specs: readonly ListingFieldSpec[];
  readonly setDetails: Dispatch<SetStateAction<Record<string, unknown>>>;
  readonly setCity: (city: City | null) => void;
  readonly setChosenKindSlug: (slug: string | null) => void;
  readonly setError: (problem: null) => void;
  readonly eventChoice: OrgEventChoice;
}

export function useListingFormSource({
  editListingId,
  republishFromListingId,
  kind,
  specs,
  setDetails,
  setCity,
  setChosenKindSlug,
  setError,
  eventChoice,
}: Args) {
  // Edit wins if both are ever given: it must never turn into a create.
  const sourceId = editListingId ?? republishFromListingId;
  const sourceQuery = useQuery({
    queryKey: ['marketplace', 'detail', sourceId],
    queryFn: () => marketplaceRepository().getListingDetail(sourceId!),
    enabled: Boolean(sourceId),
    staleTime: 60_000,
  });
  const hydratedId = useRef<string | null>(null);
  // The republish details wait here until the form shows the source's kind (see the reset below).
  const pendingSeed = useRef<ListingRepublishSeed | null>(null);
  const [seedVersion, setSeedVersion] = useState(0);
  // The source's photos a republish reuses; the member may remove them like picked ones.
  const [carriedMediaPaths, setCarriedMediaPaths] = useState<string[]>([]);
  const { setWantsOrgEvent, setOrgId } = eventChoice;
  const kindSlug = kind?.slug ?? null;

  // A new kind (direction switch) starts from its own defaults. The ride route and schedule are
  // shared by both ride kinds, so they survive the switch (RideCreateSection keeps showing them).
  // A waiting republish seed is applied instead, once the form shows the source's kind.
  useEffect(() => {
    if (editListingId) return;
    const seed = pendingSeed.current;
    if (seed && seed.kindSlug === kindSlug) {
      pendingSeed.current = null;
      setDetails({ ...initialDetailsFor(specs), ...seed.details });
    } else {
      setDetails((prev) => ({ ...pickRideDetails(prev), ...initialDetailsFor(specs) }));
    }
    setError(null);
    // `kindSlug` changes together with `specs` (one run per kind); `seedVersion` re-runs this once
    // a seed arrives. The setters are stable.
  }, [specs, kindSlug, editListingId, seedVersion, setDetails, setError]);

  // Fill the form from the source once per source listing.
  useEffect(() => {
    const detail = sourceQuery.data;
    if (!sourceId || !detail || hydratedId.current === detail.listingId) return;
    hydratedId.current = detail.listingId;
    // The source names its city by id only; CityPicker shows its name from the city list.
    if (detail.cityId) setCity({ id: detail.cityId, name: '' });
    setChosenKindSlug(detail.kindSlug);
    setError(null);
    if (editListingId) {
      setDetails({ ...detail.details });
      return;
    }
    const seed = listingRepublishSeed(detail);
    if (seed.isOrgEvent) setWantsOrgEvent(true);
    if (seed.orgId) setOrgId(seed.orgId);
    setCarriedMediaPaths(seed.mediaPaths);
    pendingSeed.current = seed;
    setSeedVersion((v) => v + 1);
  }, [sourceId, editListingId, sourceQuery.data, setCity, setChosenKindSlug, setDetails, setError, setWantsOrgEvent, setOrgId]);

  return {
    /** The source is still loading; the form shows a spinner and cannot publish yet. */
    loading: Boolean(sourceId) && sourceQuery.isLoading,
    carriedMediaPaths,
    removeCarriedMedia: (path: string) => setCarriedMediaPaths((prev) => prev.filter((p) => p !== path)),
  };
}
