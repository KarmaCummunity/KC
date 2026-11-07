// Mapped to spec: FR-POST-001 AC6 — state and publish pipeline of the listing create form
// (rides, food, housing, time). The kind is derived from request / offer: every create world
// has exactly one kind per direction, so members never pick a "listing type" — except a member of
// an organization, who may publish a time offer as the organization's event (G1 step 5, D31).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  hasInvalidRideHouseNumber,
  localIsoDate,
  localTimeHHmm,
  rideDurationMinutes,
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
  initialDetailsFor,
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
import { rideSeriesUseCases } from '../services/rideSeriesComposition';
import type { RideRecurrenceDraft } from '../components/giving/RideRecurrenceFields';
import { useOrgEventChoice } from './useOrgEventChoice';
import { pickRideDetails, rideAutoTitle, withEventOrg } from '../lib/unifiedCreate/listingCreateDetails';

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
}

export function useListingCreateForm({
  worldSlug,
  direction,
  title,
  summary,
  onPublished,
  editListingId = null,
  onSaved,
}: Args) {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const kindsQuery = useQuery({
    queryKey: ['listing-kinds', worldSlug],
    queryFn: () => marketplaceRepository().listKindsForWorld(worldSlug),
    staleTime: 10 * 60_000, // kinds change only with a migration
  });
  const editDetailQuery = useQuery({
    queryKey: ['marketplace', 'detail', editListingId],
    queryFn: () => marketplaceRepository().getListingDetail(editListingId!),
    enabled: Boolean(editListingId),
    staleTime: 60_000,
  });
  const editHydratedId = useRef<string | null>(null);
  const eventChoice = useOrgEventChoice(worldSlug, direction, kindsQuery.data ?? []);
  // The kind the member picked among several of this direction (animals, knowledge); a direction
  // switch or a kind that no longer applies falls back to the direction's default.
  const [chosenKindSlug, setChosenKindSlug] = useState<string | null>(null);
  const choices = useMemo(() => kindChoices(kindsQuery.data ?? [], direction), [kindsQuery.data, direction]);
  const kind = useMemo(
    () => kindForCreate(kindsQuery.data ?? [], direction, eventChoice.isOrgEvent, chosenKindSlug),
    [kindsQuery.data, direction, eventChoice.isOrgEvent, chosenKindSlug],
  );
  const specs = useMemo(() => (kind ? fieldsForKind(kind) : []), [kind]);

  const [details, setDetails] = useState<Record<string, unknown>>({});
  const [city, setCity] = useState<City | null>(null);
  const [photos, setPhotos] = useState<PickedImage[]>([]);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  // Additional worlds this listing should appear in (#1475).
  const [additionalWorlds, setAdditionalWorlds] = useState<string[]>([]);
  // Rides only: a recurring ride publishes a series instead of one listing (FR-RIDE-046).
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

  // A new kind (direction switch) starts from its own defaults. The ride route and schedule are
  // shared by both ride kinds, so they survive the switch (RideCreateSection keeps showing them).
  useEffect(() => {
    if (editListingId) return;
    setDetails((prev) => ({ ...pickRideDetails(prev), ...initialDetailsFor(specs) }));
    setError(null);
  }, [specs, editListingId]);

  useEffect(() => {
    const detail = editDetailQuery.data;
    if (!editListingId || !detail || editHydratedId.current === detail.listingId) return;
    editHydratedId.current = detail.listingId;
    setDetails({ ...detail.details });
    if (detail.cityId) setCity({ id: detail.cityId, name: '' });
    setChosenKindSlug(detail.kindSlug);
    setError(null);
  }, [editListingId, editDetailQuery.data]);

  const setDetail = (key: string, value: unknown) => setDetails((prev) => ({ ...prev, [key]: value }));
  const isRides = worldSlug === 'rides';
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
    const rule = marketplaceRuleFieldError({ worldSlug, direction, details: submitted, photoCount: photos.length });
    if (rule) return { message: t(rule.key), field: fieldForRule(rule.code, submitted) };
    if (isRides && recurrence && recurrence.weekdays.length === 0) {
      return { message: t('rideSeries.errors.weekdaysRequired'), field: 'ride:recurrence' };
    }
    if (isRides && !recurrence && hasInvalidRideHouseNumber(houseNumbers)) {
      return { message: t('ridePlaces.houseNumberInvalid'), field: fieldForHouseNumbers(houseNumbers) };
    }
    const schemaErr = kind ? validateListingDetails(kind.detailSchema, submitted) : null;
    return schemaErr ? { message: t('marketplace.validationFailed', { code: schemaErr }), field: null } : null;
  };

  /** A recurring ride: the series the server materializes, from the form's ride details. */
  const publishSeries = async (submitted: Record<string, unknown>, draft: RideRecurrenceDraft): Promise<string> => {
    if (!kind) throw new Error('kind_not_found');
    // The departure field's time of day is the series time; its day is only the first occurrence.
    const { departs_at: departsAt, arrives_at: _arrivesAt, ...template } = submitted;
    const created = await rideSeriesUseCases.create().execute({
      kindId: kind.kindId,
      direction,
      title: effectiveTitle,
      summary: summary.trim() || null,
      details: template,
      schedule: {
        weekdays: draft.weekdays,
        time: localTimeHHmm(new Date(String(departsAt))),
        endsOn: draft.endsOn ? localIsoDate(draft.endsOn) : null,
      },
      durationMinutes: rideDurationMinutes(submitted),
    });
    return created.firstListingId;
  };

  const publish = async () => {
    if (!userId || !kind || busy || publishLock.current) return;
    if (editListingId && editDetailQuery.isLoading) return;
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
      if (isRides && recurrence) {
        const firstId = await publishSeries(submitted, recurrence);
        trackCoreLoop('listing_created', { world: worldSlug, cityId: null });
        void rememberRideRoute(submitted);
        onPublished(firstId);
        return;
      }
      const mediaPaths = photos.length > 0 ? await uploadListingImages(userId, photos) : [];
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
          mediaPaths,
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
      setError({ message: t(marketplaceServerErrorKey(err)), field: null });
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
    busy,
    error,
    publish,
    canPublish: Boolean(userId && kind) && !busy && !(editListingId && editDetailQuery.isLoading),
    isEdit: Boolean(editListingId),
    editLoading: Boolean(editListingId && editDetailQuery.isLoading),
  };
}
