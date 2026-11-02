// Mapped to spec: FR-POST-001 AC6 — state and publish pipeline of the listing create form
// (rides, food, housing, time). The kind is derived from request / offer: every create world
// has exactly one kind per direction, so members never pick a "listing type".
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { validateListingDetails } from '@kc/domain';
import type { CreateDirection } from '../lib/unifiedCreate/createCategories';
import { WORLDS_WITH_SUBCATEGORY_PICKER } from '../lib/unifiedCreate/createCategories';
import { buildListingCreatePayload } from '../lib/unifiedCreate/unifiedCreatePayload';
import {
  detailsForSubmit,
  fieldsForKind,
  firstMissingRequiredField,
  initialDetailsFor,
  kindForDirection,
} from '../lib/unifiedCreate/listingFieldSpecs';
import { marketplaceRuleFieldError, marketplaceServerErrorKey } from '../lib/marketplaceCreateErrors';
import { marketplaceRepository } from '../services/marketplaceComposition';
import { uploadListingImages, type PickedImage } from '../services/listingImageUpload';
import { useAuthStore } from '../store/authStore';
import { trackActivationIfFirst, trackCoreLoop } from '../lib/analyticsCoreLoop';
import { rememberRideRoute } from '../lib/rides/rideStartDetails';
import { RIDE_CREATE_DETAIL_KEYS } from '../components/giving/RideCreateSection';

/** Matching radius sent with every listing; the world rules refine reach server-side. */
const DEFAULT_RADIUS_KM = 25;
const TITLE_MIN = 2;

type City = { id: string; name: string };

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
  const kind = useMemo(() => kindForDirection(kindsQuery.data ?? [], direction), [kindsQuery.data, direction]);
  const specs = useMemo(() => (kind ? fieldsForKind(kind) : []), [kind]);

  const [details, setDetails] = useState<Record<string, unknown>>({});
  const [city, setCity] = useState<City | null>(null);
  const [photos, setPhotos] = useState<PickedImage[]>([]);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
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

  /** First problem the member can fix in the form, as user-facing copy; null when valid. */
  const validate = (submitted: Record<string, unknown>): string | null => {
    if (title.trim().length < TITLE_MIN) return t('post.unifiedCreate.errors.titleRequired');
    const missing = firstMissingRequiredField(specs, details);
    if (missing) return t('post.unifiedCreate.errors.fieldRequired', { field: t(`marketplace.field.${missing.key}`) });
    if (!isRides && !city) return t('post.unifiedCreate.errors.cityRequired');
    const rule = marketplaceRuleFieldError({ worldSlug, details: submitted, photoCount: photos.length });
    if (rule) return t(rule.key);
    const schemaErr = kind ? validateListingDetails(kind.detailSchema, submitted) : null;
    return schemaErr ? t('marketplace.validationFailed', { code: schemaErr }) : null;
  };

  const publish = async () => {
    if (!userId || !kind || busy || publishLock.current) return;
    const submitted = detailsForSubmit(specs, details);
    const problem = validate(submitted);
    setError(problem);
    if (problem) return;
    publishLock.current = true;
    setBusy(true);
    try {
      const mediaPaths = photos.length > 0 ? await uploadListingImages(userId, photos) : [];
      const id = await marketplaceRepository().createListing(
        buildListingCreatePayload({
          kindId: kind.kindId,
          kindDirection: kind.direction,
          direction,
          title,
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
    showSubcategory,
    isRides,
    busy,
    error,
    publish,
    canPublish: Boolean(userId && kind) && !busy,
  };
}
