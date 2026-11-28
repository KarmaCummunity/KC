// Mapped to spec: FR-POST-001 AC6 — state and publish pipeline of the listing create form
// (rides, food, housing, time). The kind is derived from request / offer: every create world
// has exactly one kind per direction, so members never pick a "listing type" — except a member of
// an organization, who may publish a time offer as the organization's event (G1 step 5, D31).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ORG_EVENT_KIND_SLUG,
  withLeaveNowDeparture,
  type RideHouseNumbers,
} from '@kc/domain';
import type { CreateDirection } from '../lib/unifiedCreate/createCategories';
import { WORLDS_WITH_SUBCATEGORY_PICKER } from '../lib/unifiedCreate/createCategories';
import { buildListingCreatePayload } from '../lib/unifiedCreate/unifiedCreatePayload';
import {
  detailsForSubmit,
  fieldsForKind,
  kindChoices,
} from '../lib/unifiedCreate/listingFieldSpecs';
import { kindForCreate } from '../lib/unifiedCreate/orgEventCreate';
import { marketplaceServerErrorKey } from '../lib/marketplaceCreateErrors';
import type { ListingFormProblem } from '../lib/unifiedCreate/listingFormProblem';
import { firstListingProblem } from '../lib/unifiedCreate/firstListingProblem';
import { marketplaceRepository } from '../services/marketplaceComposition';
import { uploadListingImages, type PickedImage } from '../services/listingImageUpload';
import { useAuthStore } from '../store/authStore';
import { trackActivationIfFirst, trackCoreLoop } from '../lib/analyticsCoreLoop';
import { rememberRideRoute } from '../lib/rides/rideStartDetails';
import { afterRidePublished } from '../lib/rides/afterRidePublished';
import { publishEventSeries, publishRideSeries } from '../lib/unifiedCreate/seriesPublish';
import { postSeriesErrorKey } from '../lib/postSeriesError';
import type { RideRecurrenceDraft } from '../components/giving/RideRecurrenceFields';
import { useOrgEventChoice } from './useOrgEventChoice';
import { useListingFormSource } from './useListingFormSource';
import { useListingStreetAddress } from './useListingStreetAddress';
import { rideAutoTitle, withEventAddress, withEventOrg } from '../lib/unifiedCreate/listingCreateDetails';
import { useListingExposure } from './useListingExposure';
import { withJobOfferOrg } from '../lib/unifiedCreate/jobOfferOrg';
import { useJobOfferOrgChoice } from './useJobOfferOrgChoice';
import { saveMaskOrWithdraw } from '../lib/unifiedCreate/saveMaskOrWithdraw';
import { attachPendingImport } from '../lib/attachPendingImport';
import { lessonEditDetails, lessonEditFields } from '../lib/unifiedCreate/lessonEditFields';

export { rideAutoTitle };

/** Matching radius sent with every listing; the world rules refine reach server-side. */
const DEFAULT_RADIUS_KM = 25;

type City = { id: string; name: string };

interface Args {
  readonly worldSlug: string;
  readonly direction: CreateDirection;
  readonly title: string;
  readonly summary: string;
  readonly onPublished: (listingId: string) => void;
  /** When set, the form loads this listing and saves via `updateMyListing` (G1 owner edit). */
  readonly editListingId?: string | null;
  readonly onSaved?: () => void | Promise<void>;
  /** When set, the form starts from this (expired) listing minus its dates and publishes a NEW one (D127). */
  readonly republishFromListingId?: string | null;
}

export function useListingCreateForm({
  worldSlug,
  direction,
  title,
  summary,
  onPublished,
  editListingId = null,
  onSaved,
  republishFromListingId = null,
}: Args) {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const kindsQuery = useQuery({
    queryKey: ['listing-kinds', worldSlug],
    queryFn: () => marketplaceRepository().listKindsForWorld(worldSlug),
    staleTime: 10 * 60_000, // kinds change only with a migration
  });
  const eventChoice = useOrgEventChoice(worldSlug, direction, kindsQuery.data ?? []);
  // The kind the member picked among several of this direction (animals, knowledge); a direction
  // switch or a kind that no longer applies falls back to the direction's default.
  const [chosenKindSlug, setChosenKindSlug] = useState<string | null>(null);
  const choices = useMemo(() => kindChoices(kindsQuery.data ?? [], direction), [kindsQuery.data, direction]);
  const kind = useMemo(
    () => kindForCreate(kindsQuery.data ?? [], direction, eventChoice.isEvent, chosenKindSlug),
    [kindsQuery.data, direction, eventChoice.isEvent, chosenKindSlug],
  );
  const [details, setDetails] = useState<Record<string, unknown>>({});
  const editingLesson = Boolean(editListingId) && kind?.slug === 'lesson_offer';
  const createSpecs = useMemo(() => (kind ? fieldsForKind(kind) : []), [kind]);
  const specs = useMemo(() => editingLesson ? lessonEditFields(createSpecs, details) : createSpecs,
    [createSpecs, editingLesson, details]);
  // A new job offer names an organization allowed to post jobs (§5.11, #1476); an edit keeps its own.
  const jobOfferOrg = useJobOfferOrgChoice(worldSlug, editListingId ? null : kind?.slug);

  const [city, setCity] = useState<City | null>(null);
  const [photos, setPhotos] = useState<PickedImage[]>([]);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  // Additional worlds this listing should appear in (#1475).
  const [additionalWorlds, setAdditionalWorlds] = useState<string[]>([]);
  // A recurring ride (FR-RIDE-046) or a recurring event (FR-POST-024) publishes a series
  // instead of one listing; null while the post is a single one.
  const [recurrence, setRecurrence] = useState<RideRecurrenceDraft | null>(null);
  // Rides only: "leave now" departs a few minutes after publishing, whenever that is (#1411).
  const [leaveNow, setLeaveNow] = useState(false);
  const [originFromHere, setOriginFromHere] = useState(false);
  // Rides only: private house numbers of street ends, never part of the public details (AC9).
  const [houseNumbers, setHouseNumbers] = useState<RideHouseNumbers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ListingFormProblem | null>(null);
  const publishLock = useRef(false);

  // Edit / republish source: hydration and the per-kind defaults reset (useListingFormSource).
  const source = useListingFormSource({
    editListingId,
    republishFromListingId,
    kind,
    specs,
    setDetails,
    setCity,
    setChosenKindSlug,
    setSubcategoryId,
    setError,
    eventChoice,
  });
  const exposure = useListingExposure({ sourceListingId: source.sourceId, sourceDetail: source.detail, editListingId, userId });
  // A ride has no address of its own to display (its places are public stops), so no address level.
  const exposedLevel = worldSlug === 'rides' ? null : exposure.locationDisplayLevel;
  const photoCount = photos.length + source.carriedMedia.length;

  const setDetail = (key: string, value: unknown) => setDetails((prev) => ({ ...prev, [key]: value }));
  const isRides = worldSlug === 'rides';
  const isEvent = kind?.slug === ORG_EVENT_KIND_SLUG;
  // An event happens at a place: one structured address (city + street + number), KC#2288.
  const address = useListingStreetAddress({ enabled: isEvent, editListingId });
  const { street, streetNumber, clear: clearAddress } = address;
  /** A street belongs to its city, so another city starts the street over. */
  const changeCity = (next: City | null) => {
    if (next?.id !== city?.id) clearAddress();
    setCity(next);
  };
  // The recurrence of an event (a volunteering shift or an organization's); null on a single
  // event, an edit or another kind.
  const eventSeries = isEvent && !editListingId ? recurrence : null;
  // The red outline goes away as soon as the member edits the form again.
  useLayoutEffect(() => {
    setError(null);
  }, [title, details, city, street, streetNumber, recurrence, houseNumbers, eventChoice.orgId, jobOfferOrg.orgId]);
  const showSubcategory = WORLDS_WITH_SUBCATEGORY_PICKER.includes(worldSlug);
  const effectiveTitle = isRides
    ? rideAutoTitle(details, (origin, dest) => t('post.unifiedCreate.rideAutoTitle', { origin, dest })) ||
      t('post.unifiedCreate.categories.rides')
    : title.trim();

  /** First problem the member can fix in the form, with the section it belongs to; null when valid. */
  const validate = (submitted: Record<string, unknown>): ListingFormProblem | null =>
    firstListingProblem({
      t, submitted, worldSlug, direction, kind, specs, details, city, effectiveTitle, isRides, eventChoice,
      jobOfferOrg,
      addressProblem: address.problem(), editListingId, photoCount,
      subcategoryId: showSubcategory ? subcategoryId : undefined, recurrence, eventSeries, houseNumbers,
    });

  const publish = async () => {
    if (!userId || !kind || busy || publishLock.current) return;
    if (source.loading || source.initializing) return;
    const timed = isRides && !editListingId && leaveNow ? withLeaveNowDeparture(details, new Date()) : details;
    const submitted = withJobOfferOrg(
      withEventAddress(withEventOrg(detailsForSubmit(specs, timed), eventChoice), address.label),
      jobOfferOrg,
    );
    const problem = validate(submitted);
    setError(problem);
    if (problem) return;
    // FR-IMPORT-010 AC4: the values an import draft's fields are compared with after publishing.
    const publishedFields = { world: worldSlug, direction, kind: kind.slug, subcategory: showSubcategory ? subcategoryId : null,
      title: effectiveTitle, description: summary, ...(isRides ? {} : { city: city?.id ?? null }) };
    publishLock.current = true;
    setBusy(true);
    try {
      if (editListingId) {
        await marketplaceRepository().updateMyListing(editListingId, {
          title: effectiveTitle,
          summary: summary.trim() || null,
          details: editingLesson ? lessonEditDetails(submitted) : submitted,
          cityId: isRides ? null : city?.id ?? null,
          ...(exposedLevel ? { locationDisplayLevel: exposedLevel } : {}),
          visibility: exposure.visibility,
        });
        await exposure.saveIdentity(editListingId);
        await address.save(editListingId);
        await onSaved?.();
        return;
      }
      // A series: the server publishes each date; the form opens the first one.
      const seriesDraft = isRides ? recurrence : eventSeries;
      if (seriesDraft) {
        const args = { kindId: kind.kindId, title: effectiveTitle, summary, submitted, draft: seriesDraft };
        const firstId = isRides ? await publishRideSeries(args, direction) : await publishEventSeries(args, city?.id ?? '');
        trackCoreLoop('listing_created', { world: worldSlug, cityId: isRides ? null : city?.id ?? null });
        if (isRides) void rememberRideRoute(submitted);
        void attachPendingImport(firstId, publishedFields); // FR-IMPORT-007 AC3: the series' first post carries the import
        onPublished(firstId);
        return;
      }
      // A republish reuses the source's photos (already in the owner's folder) before new ones.
      const uploaded = photos.length > 0 ? await uploadListingImages(userId, photos) : [];
      const media = [...source.carriedMedia, ...uploaded];
      const id = await marketplaceRepository().createListing(
        buildListingCreatePayload({
          kindId: kind.kindId,
          kindDirection: kind.direction,
          direction,
          title: effectiveTitle,
          summary,
          details: editingLesson ? lessonEditDetails(submitted) : submitted,
          cityId: city?.id ?? null,
          // The server places the listing at its city when no coordinates are sent (0353).
          lat: null,
          lng: null,
          radiusKm: DEFAULT_RADIUS_KM,
          media,
          worldSubcategoryId: showSubcategory ? subcategoryId : null,
          additionalWorldSlugs: additionalWorlds.filter((w) => w !== worldSlug),
          visibility: exposure.visibility,
          locationDisplayLevel: exposedLevel,
        }),
      );
      await saveMaskOrWithdraw(id, exposure.saveIdentity);
      trackCoreLoop('listing_created', { world: worldSlug, cityId: city?.id ?? null });
      void trackActivationIfFirst({
        world: worldSlug,
        cityId: city?.id ?? null,
        accountCreatedAt: useAuthStore.getState().session?.accountCreatedAt,
      });
      if (isRides) {
        const flags = { isOffer: direction === 'give', originFromHere, leaveNow, recurring: false };
        await afterRidePublished(id, submitted, houseNumbers, flags);
      }
      await address.save(id);
      void attachPendingImport(id, publishedFields); // FR-IMPORT-007 AC3: a post seeded from an import is marked imported
      onPublished(id);
    } catch (err) {
      setError({ message: t(postSeriesErrorKey(err) ?? marketplaceServerErrorKey(err)), field: null });
    } finally {
      publishLock.current = false;
      setBusy(false);
    }
  };

  return {
    exposure: { ...exposure, locationDisplayLevel: exposedLevel },
    kindsQuery,
    kind,
    kindChoices: choices,
    chooseKind: setChosenKindSlug,
    specs,
    details,
    setDetails,
    setDetail,
    city,
    setCity: changeCity,
    /** Street and house number of an event; `enabled` is false for every other kind. */
    address,
    photos,
    setPhotos,
    carriedMedia: source.carriedMedia,
    removeCarriedMedia: source.removeCarriedMedia,
    subcategoryId,
    setSubcategoryId,
    additionalWorlds,
    setAdditionalWorlds,
    toggleAdditionalWorld: (slug: string) =>
      setAdditionalWorlds((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug])),
    recurrence,
    setRecurrence,
    leaveNow,
    setLeaveNow,
    setOriginFromHere,
    houseNumbers,
    setHouseNumbers,
    eventChoice,
    jobOfferOrg,
    showSubcategory,
    isRides,
    /** The form publishes an event, which may recur (FR-POST-024). */
    isEvent: isEvent && !editListingId,
    busy,
    error,
    publish,
    canPublish: Boolean(userId && kind) && !busy && !source.loading && !source.initializing && !address.loading && !exposure.loading,
    isEdit: Boolean(editListingId),
    /** The edit / republish source is loading. */
    editLoading: source.loading,
  };
}
