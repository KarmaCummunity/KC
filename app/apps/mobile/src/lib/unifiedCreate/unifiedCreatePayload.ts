// Mapped to spec: FR-POST-001 AC6.
// Submit payload builders for the unified create form — one per write path.
// Keeps the existing per-type DB writes (posts table vs marketplace listings).
import type {
  Category,
  ItemCondition,
  LocationDisplayLevel,
  PostType,
  PostVisibility,
} from '@kc/domain';
import type { CreateDirection } from './createCategories';

export interface PostPayloadArgs {
  ownerId: string;
  type: PostType;
  visibility: PostVisibility;
  title: string;
  description: string;
  category: Category;
  city: { id: string; name: string };
  street: string;
  streetNumber: string;
  locationDisplayLevel: LocationDisplayLevel;
  condition: ItemCondition;
  urgency: string;
  estimatedValue: number;
  uploads: readonly { path: string; mimeType: string; sizeBytes: number }[];
  hideFromCounterparty: boolean;
}

export function buildPostCreatePayload(a: PostPayloadArgs) {
  const isGive = a.type === 'Give';
  return {
    ownerId: a.ownerId,
    type: a.type,
    visibility: a.visibility,
    title: a.title,
    description: a.description.trim() ? a.description : null,
    category: a.category,
    address: {
      city: a.city.id,
      cityName: a.city.name,
      street: a.street,
      streetNumber: a.streetNumber,
    },
    locationDisplayLevel: a.locationDisplayLevel,
    itemCondition: isGive ? a.condition : null,
    urgency: !isGive && a.urgency.trim() ? a.urgency : null,
    estimatedValue: isGive ? a.estimatedValue : null,
    mediaAssets: a.uploads.map((u) => ({ path: u.path, mimeType: u.mimeType, sizeBytes: u.sizeBytes })),
    hideFromCounterparty: a.hideFromCounterparty,
  };
}

export interface ListingPayloadArgs {
  kindId: string;
  kindDirection: 'give' | 'request' | 'either';
  direction: CreateDirection;
  title: string;
  summary: string;
  details: Record<string, unknown>;
  cityId: string | null;
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  mediaPaths: string[];
  /** The picked world subcategory (food), null when none (KC#1296). */
  worldSubcategoryId: string | null;
}

export function buildListingCreatePayload(a: ListingPayloadArgs) {
  return {
    kindId: a.kindId,
    title: a.title.trim(),
    summary: a.summary.trim() || null,
    details: a.details,
    direction: a.kindDirection === 'either' ? a.direction : null,
    cityId: a.cityId,
    lat: a.lat,
    lng: a.lng,
    maxRadiusKm: a.radiusKm,
    mediaPaths: a.mediaPaths,
    // No create category is a routed world (medical / animals / environment), so no listing
    // from this form is ever attached to an external body.
    externalBodyId: null,
    categoryId: a.worldSubcategoryId,
  };
}
