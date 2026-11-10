// Mapped to spec: FR-POST-001 AC6 — which field of the listing create form a publish problem
// belongs to, so the form scrolls to that field and outlines only it in red.
import { hasInvalidRideHouseNumber, type MarketplaceRuleErrorCode, type RideHouseNumbers } from '@kc/domain';

/** The ride fields a problem can point at (rides have no title or city field). */
export const RIDE_FIELDS = ['ride:origin', 'ride:dest', 'ride:departure', 'ride:recurrence'] as const;
export type RideFormField = (typeof RIDE_FIELDS)[number];

/** A field of the listing form; `detail:<key>` is one category-specific field. */
export type ListingFormField = 'title' | 'city' | 'org' | 'photos' | 'subcategory' | RideFormField | `detail:${string}`;

export interface ListingFormProblem {
  readonly message: string;
  /** Null when no single field is at fault (server errors): shown above Publish. */
  readonly field: ListingFormField | null;
}

export function detailField(key: string): ListingFormField {
  return `detail:${key}`;
}

function hasCoords(details: Readonly<Record<string, unknown>>, end: 'origin' | 'dest'): boolean {
  return [`${end}_lat`, `${end}_lng`].every((k) => typeof details[k] === 'number' && Number.isFinite(details[k]));
}

/** The field a client-side world-rule failure points at. */
export function fieldForRule(code: MarketplaceRuleErrorCode, details: Readonly<Record<string, unknown>>): ListingFormField {
  switch (code) {
    case 'offer_photo_required':
      return 'photos';
    case 'food_subcategory_required':
      return 'subcategory';
    case 'ride_route_required':
      return hasCoords(details, 'origin') ? 'ride:dest' : 'ride:origin';
    case 'ride_departure_past':
      return 'ride:departure';
    case 'food_expiry_required':
      return detailField('expires_at');
    // A lesson offer or consulting hour edits a slot list (#2034); a legacy post had one slot.
    case 'knowledge_slot_invalid':
    case 'knowledge_slot_duration_invalid':
    case 'knowledge_slot_in_past':
    case 'knowledge_slots_overlap':
      return detailField(Array.isArray(details.slots) ? 'slots' : 'slot_starts_at');
    case 'event_window_invalid':
      return detailField('starts_at');
    case 'routed_world_requires_external_body':
      return 'org';
  }
}

/** The route end whose typed house number cannot be saved. */
export function fieldForHouseNumbers(raw: RideHouseNumbers): RideFormField {
  return hasInvalidRideHouseNumber({ origin: raw.origin }) ? 'ride:origin' : 'ride:dest';
}

export interface RenderedFieldsInput {
  readonly isRides: boolean;
  readonly isOrgEvent: boolean;
  readonly detailKeys: readonly string[];
  /** True in worlds whose form shows the sub-category picker (items, food, knowledge). */
  readonly showSubcategory?: boolean;
}

/** The fields the listing form currently shows (rides: route + schedule instead of title + city). */
export function renderedListingFields({ isRides, isOrgEvent, detailKeys, showSubcategory = false }: RenderedFieldsInput): Set<ListingFormField> {
  const fields = new Set<ListingFormField>(isRides ? RIDE_FIELDS : ['title', 'city']);
  // Every listing form shows the photo picker (rides place it last).
  fields.add('photos');
  if (showSubcategory) fields.add('subcategory');
  if (isOrgEvent) fields.add('org');
  for (const key of detailKeys) fields.add(detailField(key));
  return fields;
}

/**
 * The field that shows the problem inline, or null when that field is not on screen
 * (then the message sits above Publish so it is never lost).
 */
export function inlineProblemField(
  problem: ListingFormProblem | null,
  renderedFields: ReadonlySet<ListingFormField>,
): ListingFormField | null {
  if (!problem?.field) return null;
  return renderedFields.has(problem.field) ? problem.field : null;
}
