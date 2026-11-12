// Mapped to spec: FR-POST-001 AC6 — state and publish pipeline of the listing create form
// (rides, food, housing, time). The kind is derived from request / offer: every create world
// has exactly one kind per direction, so members never pick a "listing type" — except a member of
// an organization, who may publish a time offer as the organization's event (G1 step 5, D31).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ORG_EVENT_KIND_SLUG,
  hasInvalidRideHouseNumber,
  validateListingDetails,
  withLeaveNowDeparture,
  type RideHouseNumbers,
} from '@kc/domain';
import type { CreateDirection } from '../lib/unifiedCreate/createCategories';
import { WORLDS_WITH_SUBCATEGORY_PICKER } from '../lib/unifiedCreate/createCategories';
import { buildListingCreatePayload } from '../lib/unifiedCreate/unifiedCreatePayload';
import {
  detailsForSubmit,
  fieldsForKind,
  firstMissingRequiredField,
  kindChoices,
} from '../lib/unifiedCreate/listingFieldSpecs';
import { kindForCreate } from '../lib/unifiedCreate/orgEventCreate';
import { marketplaceRuleFieldError, marketplaceServerErrorKey } from '../lib/marketplaceCreateErrors';
import {
  detailField,
  fieldForHouseNumbers,
  fieldForRule,
  type ListingFormProblem,
} from '../lib/unifiedCreate/listingFormProblem';
import { marketplaceRepository } from '../services/marketplaceComposition';
import { uploadListingImages, type PickedImage } from '../services/listingImageUpload';
import { useAuthStore } from '../store/authStore';
import { trackActivationIfFirst, trackCoreLoop } from '../lib/analyticsCoreLoop';
import { rememberRideRoute } from '../lib/rides/rideStartDetails';
import { afterRidePublished } from '../lib/rides/afterRidePublished';
import { isEventSeriesDuration, publishEventSeries, publishRideSeries } from '../lib/unifiedCreate/seriesPublish';
import { postSeriesErrorKey } from '../lib/postSeriesError';
import type { RideRecurrenceDraft } from '../components/giving/RideRecurrenceFields';
import { useOrgEventChoice } from './useOrgEventChoice';
import { useListingFormSource } from './useListingFormSource';
import { rideAutoTitle, withEventOrg } from '../lib/unifiedCreate/listingCreateDetails';

export { rideAutoTitle };

/** Matching radius sent with every listing; the world rules refine reach server-side. */
const DEFAULT_RADIUS_KM = 25;
const TITLE_MIN = 2;

type City = { id: string; name: string };

interface Args {
  readonly worldSlug: string;
  readonly direction: CreateDirection;
  readonly title: string;
  readonly summary: string;
  readonly onPublished: (listingId: string) => void;
  /** When set, the form loads this listing and saves via `updateMyListing` (G1 owner edit). */
  readonly editListingId?: string | null;
  readonly onSaved?: () => void;
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
  const specs = useMemo(() => (kind ? fieldsForKind(kind) : []), [kind]);

  const [details, setDetails] = useState<Record<string, unknown>>({});
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

  // The red outline goes away as soon as the member edits the form again.
  useEffect(() => {
    setError(null);
  }, [title, details, city, recurrence, houseNumbers, eventChoice.orgId]);

  // Edit / republish source: hydration and the per-kind defaults reset (useListingFormSource).
  const source = useListingFormSource({
    editListingId,
    republishFromListingId,
    kind,
    specs,
    setDetails,
    setCity,
    setChosenKindSlug,
    setError,
    eventChoice,
  });
  const photoCount = photos.length + source.carriedMedia.length;

  const setDetail = (key: string, value: unknown) => setDetails((prev) => ({ ...prev, [key]: value }));
  const isRides = worldSlug === 'rides';
  // The recurrence of an event (a volunteering shift or an organization's); null on a single
  // event, an edit or another kind.
  const isEvent = kind?.slug === ORG_EVENT_KIND_SLUG;
  const eventSeries = isEvent && !editListingId ? recurrence : null;
  const showSubcategory = WORLDS_WITH_SUBCATEGORY_PICKER.includes(worldSlug);
  const effectiveTitle = isRides
    ? rideAutoTitle(details, (origin, dest) => t('post.unifiedCreate.rideAutoTitle', { origin, dest })) ||
      t('post.unifiedCreate.categories.rides')
    : title.trim();

  /** First problem the member can fix in the form, with the section it belongs to; null when valid. */
  const validate = (submitted: Record<string, unknown>): ListingFormProblem | null => {
    // Rides have no title field: it is derived from the route (#1411).
    if (!isRides && effectiveTitle.length < TITLE_MIN) {
      return { message: t('post.unifiedCreate.errors.titleRequired'), field: 'title' };
    }
    const missing = firstMissingRequiredField(specs, details);
    if (missing) {
      const message = t('post.unifiedCreate.errors.fieldRequired', { field: t(`marketplace.field.${missing.key}`) });
      return { message, field: detailField(missing.key) };
    }
    if (eventChoice.isOrgEvent && !eventChoice.orgId) return { message: t('eventPost.create.orgRequired'), field: 'org' };
    if (!isRides && !city) return { message: t('post.unifiedCreate.errors.cityRequired'), field: 'city' };
    // An edit keeps the listing's photos and sub-category, so it passes neither and skips those rules.
    const creating = editListingId ? {} : { photoCount, subcategoryId: showSubcategory ? subcategoryId : undefined };
    const rule = marketplaceRuleFieldError({ worldSlug, direction, details: submitted, ...creating });
    if (rule) return { message: t(rule.key), field: fieldForRule(rule.code, submitted) };
    if (isRides && recurrence && recurrence.weekdays.length === 0) {
      return { message: t('rideSeries.errors.weekdaysRequired'), field: 'ride:recurrence' };
    }
    if (eventSeries && eventSeries.weekdays.length === 0) return { message: t('postSeries.errors.weekdaysRequired'), field: null };
    if (eventSeries && !isEventSeriesDuration(submitted)) return { message: t('postSeries.errors.durationInvalid'), field: null };
    if (isRides && !recurrence && hasInvalidRideHouseNumber(houseNumbers)) {
      return { message: t('ridePlaces.houseNumberInvalid'), field: fieldForHouseNumbers(houseNumbers) };
    }
    const schemaErr = kind ? validateListingDetails(kind.detailSchema, submitted) : null;
    return schemaErr ? { message: t('marketplace.validationFailed', { code: schemaErr }), field: null } : null;
  };

  const publish = async () => {
    if (!userId || !kind || busy || publishLock.current) return;
    if (source.loading) return;
    const timed = isRides && !editListingId && leaveNow ? withLeaveNowDeparture(details, new Date()) : details;
    const submitted = withEventOrg(detailsForSubmit(specs, timed), eventChoice);
    const problem = validate(submitted);
    setError(problem);
    if (problem) return;
    publishLock.current = true;
    setBusy(true);
    try {
      if (editListingId) {
        await marketplaceRepository().updateMyListing(editListingId, {
          title: effectiveTitle,
          summary: summary.trim() || null,
          details: submitted,
          cityId: isRides ? null : city?.id ?? null,
        });
        onSaved?.();
        return;
      }
      // A series: the server publishes each date; the form opens the first one.
      const seriesDraft = isRides ? recurrence : eventSeries;
      if (seriesDraft) {
        const args = { kindId: kind.kindId, title: effectiveTitle, summary, submitted, draft: seriesDraft };
        const firstId = isRides ? await publishRideSeries(args, direction) : await publishEventSeries(args, city?.id ?? '');
        trackCoreLoop('listing_created', { world: worldSlug, cityId: isRides ? null : city?.id ?? null });
        if (isRides) void rememberRideRoute(submitted);
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
          details: submitted,
          cityId: city?.id ?? null,
          // The server places the listing at its city when no coordinates are sent (0353).
          lat: null,
          lng: null,
          radiusKm: DEFAULT_RADIUS_KM,
          media,
          worldSubcategoryId: showSubcategory ? subcategoryId : null,
          additionalWorldSlugs: additionalWorlds.filter((w) => w !== worldSlug),
        }),
      );
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
      onPublished(id);
    } catch (err) {
      setError({ message: t(postSeriesErrorKey(err) ?? marketplaceServerErrorKey(err)), field: null });
    } finally {
      publishLock.current = false;
      setBusy(false);
    }
  };

  return {
    kindsQuery,
    kind,
    kindChoices: choices,
    chooseKind: setChosenKindSlug,
    specs,
    details,
    setDetails,
    setDetail,
    city,
    setCity,
    photos,
    setPhotos,
    carriedMedia: source.carriedMedia,
    removeCarriedMedia: source.removeCarriedMedia,
    subcategoryId,
    setSubcategoryId,
    additionalWorlds,
    setAdditionalWorlds,
    toggleAdditionalWorld: (slug: string) => {
      setAdditionalWorlds((prev) =>
        prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
      );
    },
    recurrence,
    setRecurrence,
    leaveNow,
    setLeaveNow,
    setOriginFromHere,
    houseNumbers,
    setHouseNumbers,
    eventChoice,
    showSubcategory,
    isRides,
    /** The form publishes an event, which may recur (FR-POST-024). */
    isEvent: isEvent && !editListingId,
    busy,
    error,
    publish,
    canPublish: Boolean(userId && kind) && !busy && !source.loading,
    isEdit: Boolean(editListingId),
    /** The edit / republish source is loading. */
    editLoading: source.loading,
  };
}
