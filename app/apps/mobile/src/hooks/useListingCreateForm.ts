// Mapped to spec: FR-POST-001 AC6 — state and publish pipeline of the listing create form
// (rides, food, housing, time). The kind is derived from request / offer: every create world
// has exactly one kind per direction, so members never pick a "listing type" — except a member of
// an organization, who may publish a time offer as the organization's event (G1 step 5, D31).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { localIsoDate, localTimeHHmm, rideDurationMinutes, validateListingDetails, withLeaveNowDeparture } from '@kc/domain';
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
import { marketplaceRepository } from '../services/marketplaceComposition';
import { uploadListingImages, type PickedImage } from '../services/listingImageUpload';
import { useAuthStore } from '../store/authStore';
import { trackActivationIfFirst, trackCoreLoop } from '../lib/analyticsCoreLoop';
import { rememberRideRoute } from '../lib/rides/rideStartDetails';
import { rideSeriesUseCases } from '../services/rideSeriesComposition';
import { RIDE_CREATE_DETAIL_KEYS } from '../components/giving/RideCreateSection';
import type { RideRecurrenceDraft } from '../components/giving/RideRecurrenceFields';
import { useOrgEventChoice, type OrgEventChoice } from './useOrgEventChoice';

/** Matching radius sent with every listing; the world rules refine reach server-side. */
const DEFAULT_RADIUS_KM = 25;
const TITLE_MIN = 2;

type City = { id: string; name: string };

/** Rides have no title field (#1411): the title is built from the route, e.g. "Lod → Tel Aviv". */
export function rideAutoTitle(
  details: Readonly<Record<string, unknown>>,
  format: (origin: string, dest: string) => string,
): string {
  const origin = typeof details.origin_label === 'string' ? details.origin_label.trim() : '';
  const dest = typeof details.dest_label === 'string' ? details.dest_label.trim() : '';
  return origin && dest ? format(origin, dest) : '';
}

/** An organization's event carries the organization it is published for (`details.org_id`). */
function withEventOrg(details: Record<string, unknown>, choice: OrgEventChoice): Record<string, unknown> {
  return choice.isOrgEvent && choice.orgId ? { ...details, org_id: choice.orgId } : details;
}

/** The ride route + schedule of `details` (empty for every other world). */
function pickRideDetails(details: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of RIDE_CREATE_DETAIL_KEYS) if (key in details) out[key] = details[key];
  return out;
}

interface Args {
  readonly worldSlug: string;
  readonly direction: CreateDirection;
  readonly title: string;
  readonly summary: string;
  readonly onPublished: (listingId: string) => void;
}

export function useListingCreateForm({ worldSlug, direction, title, summary, onPublished }: Args) {
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
    () => kindForCreate(kindsQuery.data ?? [], direction, eventChoice.isOrgEvent, chosenKindSlug),
    [kindsQuery.data, direction, eventChoice.isOrgEvent, chosenKindSlug],
  );
  const specs = useMemo(() => (kind ? fieldsForKind(kind) : []), [kind]);

  const [details, setDetails] = useState<Record<string, unknown>>({});
  const [city, setCity] = useState<City | null>(null);
  const [photos, setPhotos] = useState<PickedImage[]>([]);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  // Rides only: a recurring ride publishes a series instead of one listing (FR-RIDE-046).
  const [recurrence, setRecurrence] = useState<RideRecurrenceDraft | null>(null);
  // Rides only: "leave now" departs a few minutes after publishing, whenever that is (#1411).
  const [leaveNow, setLeaveNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publishLock = useRef(false);

  // A new kind (direction switch) starts from its own defaults. The ride route and schedule are
  // shared by both ride kinds, so they survive the switch (RideCreateSection keeps showing them).
  useEffect(() => {
    setDetails((prev) => ({ ...pickRideDetails(prev), ...initialDetailsFor(specs) }));
    setError(null);
  }, [specs]);

  const setDetail = (key: string, value: unknown) => setDetails((prev) => ({ ...prev, [key]: value }));
  const isRides = worldSlug === 'rides';
  const showSubcategory = WORLDS_WITH_SUBCATEGORY_PICKER.includes(worldSlug);
  const effectiveTitle = isRides
    ? rideAutoTitle(details, (origin, dest) => t('post.unifiedCreate.rideAutoTitle', { origin, dest })) ||
      t('post.unifiedCreate.categories.rides')
    : title.trim();

  /** First problem the member can fix in the form, as user-facing copy; null when valid. */
  const validate = (submitted: Record<string, unknown>): string | null => {
    // Rides have no title field: it is derived from the route (#1411).
    if (!isRides && effectiveTitle.length < TITLE_MIN) return t('post.unifiedCreate.errors.titleRequired');
    const missing = firstMissingRequiredField(specs, details);
    if (missing) return t('post.unifiedCreate.errors.fieldRequired', { field: t(`marketplace.field.${missing.key}`) });
    if (eventChoice.isOrgEvent && !eventChoice.orgId) return t('eventPost.create.orgRequired');
    if (!isRides && !city) return t('post.unifiedCreate.errors.cityRequired');
    const rule = marketplaceRuleFieldError({ worldSlug, direction, details: submitted, photoCount: photos.length });
    if (rule) return t(rule.key);
    if (isRides && recurrence && recurrence.weekdays.length === 0) return t('rideSeries.errors.weekdaysRequired');
    const schemaErr = kind ? validateListingDetails(kind.detailSchema, submitted) : null;
    return schemaErr ? t('marketplace.validationFailed', { code: schemaErr }) : null;
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
    const timed = isRides && leaveNow ? withLeaveNowDeparture(details, new Date()) : details;
    const submitted = withEventOrg(detailsForSubmit(specs, timed), eventChoice);
    const problem = validate(submitted);
    setError(problem);
    if (problem) return;
    publishLock.current = true;
    setBusy(true);
    try {
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
        }),
      );
      trackCoreLoop('listing_created', { world: worldSlug, cityId: city?.id ?? null });
      void trackActivationIfFirst({
        world: worldSlug,
        cityId: city?.id ?? null,
        accountCreatedAt: useAuthStore.getState().session?.accountCreatedAt,
      });
      // The next ride from this device starts from this route (D75).
      if (isRides) void rememberRideRoute(submitted);
      onPublished(id);
    } catch (err) {
      setError(t(marketplaceServerErrorKey(err)));
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
    recurrence,
    setRecurrence,
    leaveNow,
    setLeaveNow,
    eventChoice,
    showSubcategory,
    isRides,
    busy,
    error,
    publish,
    canPublish: Boolean(userId && kind) && !busy,
  };
}
