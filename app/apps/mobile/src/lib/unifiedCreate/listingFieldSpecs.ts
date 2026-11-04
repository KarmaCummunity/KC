// Mapped to spec: FR-POST-001 AC6 (category-specific fields per request / offer) ·
// product book docs/spec/07 §7.2 (unique fields per post type).
// Curated, typed field set per listing kind. The create form renders exactly these fields
// instead of every key of the kind's JSON schema, so members never see internal keys
// (linked ids, org slugs) and every field gets a purpose-built control.
import {
  EVENT_CAPACITY_MAX,
  EVENT_CAPACITY_MIN,
  EVENT_REGISTRATION_POLICIES,
  ORG_EVENT_KIND_SLUG,
  RIDE_COST_CAP_INTERCITY_ILS,
  type ListingKindOption,
} from '@kc/domain';
import type { CreateDirection } from './createCategories';
import { ANIMALS_FIELD_SPECS } from './animalsFieldSpecs';
import { HOUSING_FIELD_SPECS } from './housingFieldSpecs';
import { KNOWLEDGE_FIELD_SPECS } from './knowledgeFieldSpecs';

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
  // A local calendar day, stored as `yyyy-MM-dd` (housing check-in / check-out).
  | (BaseSpec & { readonly type: 'date' })
  // A local time of day, stored as `HH:mm` (housing check-in window, check-out time).
  | (BaseSpec & { readonly type: 'time'; readonly defaultValue: string })
  | (BaseSpec & { readonly type: 'amount'; readonly max: number })
  // An optional whole number typed in, clamped to [min, max] (an event's capacity).
  | (BaseSpec & { readonly type: 'integer'; readonly min: number; readonly max: number })
  | (BaseSpec & { readonly type: 'text'; readonly multiline?: boolean; readonly maxLength: number })
  | (BaseSpec & { readonly type: 'toggle'; readonly defaultValue?: boolean })
  // A detail the form sets without a control (no editor for it yet); seeded from `defaultValue`.
  | (BaseSpec & { readonly type: 'fixed'; readonly defaultValue: unknown });

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
  ...HOUSING_FIELD_SPECS,
  ...KNOWLEDGE_FIELD_SPECS,
  ...ANIMALS_FIELD_SPECS,
  volunteer_shift: [{ key: 'duration_minutes', type: 'duration', options: DURATIONS_MIN, defaultValue: 60 }],
  // An organization's event (G1 step 5, 0563). The organization (`org_id`) has its own picker
  // (OrganizationPicker), so it is not a field here; the window rule is checked on publish.
  [ORG_EVENT_KIND_SLUG]: [
    { key: 'starts_at', type: 'dateTime', required: true },
    { key: 'ends_at', type: 'dateTime', required: true },
    { key: 'registration_policy', type: 'choice', required: true, options: EVENT_REGISTRATION_POLICIES, defaultValue: 'automatic' },
    { key: 'capacity', type: 'integer', min: EVENT_CAPACITY_MIN, max: EVENT_CAPACITY_MAX },
    { key: 'address', type: 'text', maxLength: 160 },
  ],
  // Emotional support is routed to a hotline, never a member post (docs/spec/05 §5.4).
  support_request: [
    { key: 'support_type', type: 'choice', required: true, options: ['companionship', 'practical', 'escort'] },
    { key: 'duration_minutes', type: 'duration', options: DURATIONS_MIN, defaultValue: 60 },
  ],
};

/**
 * The default kind for `direction`: an exact match first, then a kind open to both directions.
 * An organization's event is never the default: only a member of an organization picks it
 * (lib/unifiedCreate/orgEventCreate).
 */
export function kindForDirection(
  kinds: readonly ListingKindOption[],
  direction: CreateDirection,
): ListingKindOption | null {
  const regular = kinds.filter((k) => k.slug !== ORG_EVENT_KIND_SLUG);
  return regular.find((k) => k.direction === direction) ?? regular.find((k) => k.direction === 'either') ?? null;
}

/**
 * The kinds a member can pick between for `direction` (a world with several kinds per direction,
 * e.g. animals: hand an animal over or offer boarding). Never includes an organization's event.
 */
export function kindChoices(
  kinds: readonly ListingKindOption[],
  direction: CreateDirection,
): readonly ListingKindOption[] {
  return kinds.filter((k) => k.slug !== ORG_EVENT_KIND_SLUG && (k.direction === direction || k.direction === 'either'));
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

/** Typed digits as a whole number within [min, max]; undefined (field cleared) when there are none. */
export function clampWholeNumber(text: string, min: number, max: number): number | undefined {
  const n = Number.parseInt(text.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined;
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
