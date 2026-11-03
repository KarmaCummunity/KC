// Mapped to spec: FR-POST-001 AC6 (category-specific fields per request / offer) ·
// product book docs/spec/07 §7.2 (unique fields per post type).
// Curated, typed field set per listing kind. The create form renders exactly these fields
// instead of every key of the kind's JSON schema, so members never see internal keys
// (linked ids, org slugs) and every field gets a purpose-built control.
import { RIDE_COST_CAP_INTERCITY_ILS, type ListingKindOption } from '@kc/domain';
import type { CreateDirection } from './createCategories';

/** Shows a field only while another detail holds a given value. */
interface VisibleWhen {
  readonly key: string;
  readonly equals: unknown;
}

interface BaseSpec {
  /** Detail key inside `listings.details` (must exist in the kind's detail schema). */
  readonly key: string;
  readonly required?: boolean;
  readonly visibleWhen?: VisibleWhen;
}

export type ListingFieldSpec =
  | (BaseSpec & { readonly type: 'choice'; readonly options: readonly string[]; readonly defaultValue?: string })
  | (BaseSpec & { readonly type: 'multiChoice'; readonly options: readonly string[] })
  | (BaseSpec & { readonly type: 'count'; readonly min: number; readonly max: number; readonly defaultValue: number })
  | (BaseSpec & { readonly type: 'duration'; readonly options: readonly number[]; readonly defaultValue: number })
  | (BaseSpec & { readonly type: 'dateTime' })
  | (BaseSpec & { readonly type: 'amount'; readonly max: number })
  | (BaseSpec & { readonly type: 'text'; readonly multiline?: boolean; readonly maxLength: number })
  | (BaseSpec & { readonly type: 'toggle' });

const DURATIONS_MIN: readonly number[] = [30, 60, 120, 180, 240];

/** Field sets keyed by listing kind slug (`listing_kinds.slug`). Order = render order. */
const SPECS_BY_KIND: Readonly<Record<string, readonly ListingFieldSpec[]>> = {
  give_food: [
    { key: 'food_type', type: 'choice', required: true, options: ['cooked', 'packaged', 'fresh', 'frozen', 'dry', 'beverage'] },
    { key: 'expires_at', type: 'dateTime', required: true },
    { key: 'allergens', type: 'multiChoice', options: ['gluten', 'milk', 'eggs', 'nuts', 'peanuts', 'soy', 'fish', 'sesame'] },
    { key: 'kosher', type: 'choice', options: ['yes', 'no'] },
    { key: 'pickup_mode', type: 'choice', options: ['pickup', 'delivery', 'either'], defaultValue: 'pickup' },
  ],
  request_food: [
    { key: 'household_size', type: 'count', min: 1, max: 12, defaultValue: 1 },
    { key: 'dietary_needs', type: 'text', maxLength: 200 },
  ],
  // Route, departure, estimated end and seats belong to RideCreateSection (D71, D75); these are
  // the remaining ride fields.
  ride_offer: [
    { key: 'reward_model', type: 'choice', options: ['free', 'expense_share'], defaultValue: 'free' },
    // Clamped to the intercity cap; the urban cap is enforced server-side (`ride_cost_share_cap_exceeded`).
    { key: 'cost_share_ils', type: 'amount', max: RIDE_COST_CAP_INTERCITY_ILS, visibleWhen: { key: 'reward_model', equals: 'expense_share' } },
  ],
  ride_request: [
    { key: 'passengers', type: 'count', min: 1, max: 8, defaultValue: 1 },
    { key: 'luggage', type: 'toggle' },
  ],
  host_offer: [
    { key: 'place_type', type: 'choice', options: ['room', 'couch', 'apartment'] },
    { key: 'capacity', type: 'count', min: 1, max: 10, defaultValue: 1 },
    { key: 'house_rules', type: 'text', multiline: true, maxLength: 300 },
  ],
  stay_request: [{ key: 'party_size', type: 'count', min: 1, max: 10, defaultValue: 1 }],
  volunteer_shift: [{ key: 'duration_minutes', type: 'duration', options: DURATIONS_MIN, defaultValue: 60 }],
  // Emotional support is routed to a hotline, never a member post (docs/spec/05 §5.4).
  support_request: [
    { key: 'support_type', type: 'choice', required: true, options: ['companionship', 'practical', 'escort'] },
    { key: 'duration_minutes', type: 'duration', options: DURATIONS_MIN, defaultValue: 60 },
  ],
};

/** The kind for `direction`: an exact match first, then a kind open to both directions. */
export function kindForDirection(
  kinds: readonly ListingKindOption[],
  direction: CreateDirection,
): ListingKindOption | null {
  return kinds.find((k) => k.direction === direction) ?? kinds.find((k) => k.direction === 'either') ?? null;
}

type SchemaProperty = { enum?: readonly unknown[] };

function schemaProperties(kind: ListingKindOption): Record<string, SchemaProperty> {
  const props = (kind.detailSchema as { properties?: unknown }).properties;
  return props && typeof props === 'object' ? (props as Record<string, SchemaProperty>) : {};
}

/** Keeps only the options the server enum accepts (the schema is the source of truth). */
function narrowOptions(spec: ListingFieldSpec, prop: SchemaProperty): ListingFieldSpec {
  if (!Array.isArray(prop.enum) || (spec.type !== 'choice' && spec.type !== 'multiChoice')) return spec;
  const allowed = new Set(prop.enum);
  return { ...spec, options: spec.options.filter((o) => allowed.has(o)) };
}

/**
 * The fields the form renders for `kind`. A field whose key is missing from the kind's
 * schema is dropped, because the server rejects unknown detail keys
 * (`additionalProperties: false`, migration 0321).
 */
export function fieldsForKind(kind: ListingKindOption): readonly ListingFieldSpec[] {
  const props = schemaProperties(kind);
  return (SPECS_BY_KIND[kind.slug] ?? [])
    .filter((spec) => spec.key in props)
    .map((spec) => narrowOptions(spec, props[spec.key]!));
}

/** Whether `spec` is shown for the current details (conditional fields). */
export function isFieldVisible(spec: ListingFieldSpec, details: Readonly<Record<string, unknown>>): boolean {
  return !spec.visibleWhen || details[spec.visibleWhen.key] === spec.visibleWhen.equals;
}

/** Initial details for a freshly selected kind: every field that has a default. */
export function initialDetailsFor(specs: readonly ListingFieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of specs) {
    if ('defaultValue' in spec && spec.defaultValue !== undefined) out[spec.key] = spec.defaultValue;
  }
  return out;
}

function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** First visible required field without a value, or null when every one is filled. */
export function firstMissingRequiredField(
  specs: readonly ListingFieldSpec[],
  details: Readonly<Record<string, unknown>>,
): ListingFieldSpec | null {
  return specs.find((s) => s.required && isFieldVisible(s, details) && isEmptyValue(details[s.key])) ?? null;
}

/**
 * Details sent on publish: hidden conditional fields and empty values are dropped; keys the
 * form fills outside the curated fields (the ride route endpoints) pass through unchanged.
 */
export function detailsForSubmit(
  specs: readonly ListingFieldSpec[],
  details: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const hidden = new Set(specs.filter((s) => !isFieldVisible(s, details)).map((s) => s.key));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!hidden.has(key) && !isEmptyValue(value)) out[key] = value;
  }
  return out;
}
