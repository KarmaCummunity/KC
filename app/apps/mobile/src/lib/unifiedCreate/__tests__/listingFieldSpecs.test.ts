// FR-POST-001 AC6 — each listing kind renders a curated, schema-safe field set: no internal
// keys, every key accepted by the server schema, defaults, required checks and submit cleanup.
import { describe, expect, it } from 'vitest';
import { ORG_EVENT_KIND_SLUG, validateListingDetails } from '@kc/domain';
import {
  detailsForSubmit,
  fieldsForKind,
  firstMissingRequiredField,
  clampWholeNumber,
  initialDetailsFor,
  isFieldVisible,
  kindChoices,
  kindForDirection,
} from '../listingFieldSpecs';
import { KINDS_BY_WORLD } from './listingKindFixtures';
// eslint-disable-next-line no-restricted-imports -- test asserts every field / option label exists in Hebrew
import he from '../../../i18n/locales/he';

const ALL_KINDS = Object.values(KINDS_BY_WORLD).flat();
const keysOf = (slug: string) => fieldsForKind(ALL_KINDS.find((k) => k.slug === slug)!).map((s) => s.key);

function resolveKey(key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], he);
}

describe('listing field specs — per kind', () => {
  it('every listing kind of the four worlds has at least one curated field', () => {
    for (const kind of ALL_KINDS) expect(fieldsForKind(kind).length).toBeGreaterThan(0);
  });

  it('every rendered key exists in the kind schema (the server rejects unknown keys)', () => {
    for (const kind of ALL_KINDS) {
      const props = (kind.detailSchema as { properties: Record<string, unknown> }).properties;
      for (const spec of fieldsForKind(kind)) expect(Object.keys(props)).toContain(spec.key);
    }
  });

  it('never shows internal or legacy keys', () => {
    const shown = ALL_KINDS.flatMap((k) => fieldsForKind(k).map((s) => s.key));
    // `org_id` has its own organization picker (G1 step 5).
    for (const internal of ['linked_listing_id', 'org_host_slug', 'fulfillment_mode', 'origin_lat', 'guest_scenario', 'org_id']) {
      expect(shown).not.toContain(internal);
    }
  });

  it('renders the purpose-built fields of each category (docs/spec/07 §7.2)', () => {
    expect(keysOf('give_food')).toEqual(['food_type', 'expires_at', 'allergens', 'kosher', 'pickup_mode']);
    expect(keysOf('request_food')).toEqual(['household_size', 'dietary_needs']);
    // Route, departure, estimated end and seats are rendered by RideCreateSection (D71, D75).
    expect(keysOf('ride_offer')).toEqual(['reward_model', 'cost_share_ils']);
    expect(keysOf('ride_request')).toEqual(['passengers', 'luggage']);
    expect(keysOf('host_offer')).toEqual([
      'place_type', 'capacity', 'exclusive', 'min_nights', 'max_nights', 'check_in_from', 'check_in_until',
      'check_out_by', 'guest_policy', 'children_ok', 'pets_ok', 'smoking', 'amenities', 'accessibility',
      'household', 'house_rules', 'availability',
    ]);
    expect(keysOf('stay_request')).toEqual([
      'stay_purpose', 'check_in_date', 'check_out_date', 'flexible_days', 'adults', 'minors', 'near_trail', 'gear', 'needs',
    ]);
    expect(keysOf('course')).toEqual(['topic', 'level', 'modality', 'slot_starts_at', 'slot_ends_at', 'slots_available']);
    expect(keysOf('private_lesson')).toEqual([
      'topic', 'level', 'modality', 'slot_starts_at', 'slot_ends_at', 'slots_available', 'availability_note',
    ]);
    expect(keysOf('mentorship_request')).toEqual(['topic', 'level', 'preferred_modality']);
    expect(keysOf('adoption_offer')).toEqual(['species', 'age_group', 'sex', 'size', 'vaccinated', 'neutered', 'good_with']);
    expect(keysOf('adoption_request')).toEqual(['species', 'age_group', 'size']);
    expect(keysOf('foster_offer')).toEqual(['species', 'care_mode', 'location_mode', 'duration_days']);
    expect(keysOf('foster_request')).toEqual(['species', 'care_mode', 'location_mode', 'starts_on', 'ends_on']);
    expect(keysOf('volunteer_shift')).toEqual(['duration_minutes']);
    expect(keysOf('support_request')).toEqual(['support_type', 'duration_minutes']);
    expect(keysOf('org_event')).toEqual(['starts_at', 'ends_at', 'registration_policy', 'capacity', 'address']);
  });

  it('offers no emotional-support option: it is routed to a hotline (docs/spec/05 §5.4)', () => {
    const support = fieldsForKind(KINDS_BY_WORLD.time![1]!).find((s) => s.key === 'support_type')!;
    expect(support.type === 'choice' && support.options).toEqual(['companionship', 'practical', 'escort']);
  });

  it('narrows options to the server enum', () => {
    const narrowed = { ...KINDS_BY_WORLD.food![0]!, detailSchema: { properties: { food_type: { enum: ['cooked'] } } } };
    const [spec] = fieldsForKind(narrowed);
    expect(spec?.type === 'choice' && spec.options).toEqual(['cooked']);
  });

  it('an unknown kind or an empty schema renders no curated fields', () => {
    expect(fieldsForKind({ ...KINDS_BY_WORLD.food![0]!, slug: 'nope' })).toEqual([]);
    expect(fieldsForKind({ ...KINDS_BY_WORLD.food![0]!, detailSchema: {} })).toEqual([]);
  });

  it('every field and option has a Hebrew label', () => {
    for (const spec of ALL_KINDS.flatMap((k) => fieldsForKind(k))) {
      expect(typeof resolveKey(`marketplace.field.${spec.key}`)).toBe('string');
      const options = spec.type === 'choice' || spec.type === 'multiChoice' ? spec.options : [];
      for (const o of options) expect(typeof resolveKey(`marketplace.option.${o}`)).toBe('string');
      const durations = spec.type === 'duration' ? spec.options : [];
      for (const d of durations) expect(typeof resolveKey(`post.unifiedCreate.duration.${d}`)).toBe('string');
    }
  });
});

describe('listing field specs — values', () => {
  const rideOffer = fieldsForKind(KINDS_BY_WORLD.rides![0]!);
  const foodOffer = fieldsForKind(KINDS_BY_WORLD.food![0]!);

  it('starts from the field defaults', () => {
    expect(initialDetailsFor(rideOffer)).toEqual({ reward_model: 'free' });
    expect(initialDetailsFor(foodOffer)).toEqual({ pickup_mode: 'pickup' });
  });

  it('keeps rides free: the cost model has no control and the amount stays hidden', () => {
    expect(rideOffer.find((s) => s.key === 'reward_model')?.type).toBe('fixed');
    const amount = rideOffer.find((s) => s.key === 'cost_share_ils')!;
    expect(isFieldVisible(amount, initialDetailsFor(rideOffer))).toBe(false);
  });

  it('reports the first missing required field, in render order', () => {
    expect(firstMissingRequiredField(foodOffer, {})?.key).toBe('food_type');
    expect(firstMissingRequiredField(foodOffer, { food_type: 'cooked' })?.key).toBe('expires_at');
    expect(firstMissingRequiredField(foodOffer, { food_type: 'cooked', expires_at: '2030-01-01T10:00:00.000Z' })).toBeNull();
  });

  it('drops hidden and empty values on submit but keeps the ride route', () => {
    const submitted = detailsForSubmit(rideOffer, {
      reward_model: 'free',
      cost_share_ils: 30,
      seats_available: 2,
      origin_lat: 31.9,
      luggage: undefined,
      arrives_at: '',
    });
    // Keys owned by RideCreateSection (seats, route) pass through untouched.
    expect(submitted).toEqual({ reward_model: 'free', seats_available: 2, origin_lat: 31.9 });
  });

  it('a filled food offer validates against the server schema', () => {
    const details = detailsForSubmit(foodOffer, {
      ...initialDetailsFor(foodOffer),
      food_type: 'cooked',
      expires_at: '2030-01-01T10:00:00.000Z',
      allergens: ['milk'],
      kosher: 'yes',
    });
    expect(validateListingDetails(KINDS_BY_WORLD.food![0]!.detailSchema, details)).toBeNull();
  });
});

describe('listing field specs — housing stays (FR-HOUSING-005, 006)', () => {
  const hostOffer = fieldsForKind(KINDS_BY_WORLD.housing![0]!);
  const stayRequest = fieldsForKind(KINDS_BY_WORLD.housing![1]!);
  // `required` of the host_offer schema in migration 0600.
  const OFFER_REQUIRED = [
    'place_type', 'capacity', 'exclusive', 'min_nights', 'max_nights', 'check_in_from', 'check_in_until',
    'check_out_by', 'guest_policy', 'children_ok', 'pets_ok', 'smoking', 'availability',
  ];

  it('a host who changes nothing still sends every key the server requires', () => {
    const submitted = detailsForSubmit(hostOffer, initialDetailsFor(hostOffer));
    expect(Object.keys(submitted)).toEqual(expect.arrayContaining(OFFER_REQUIRED));
    // Booleans set to false are values, not empty fields.
    expect(submitted).toMatchObject({ exclusive: false, pets_ok: false, availability: { mode: 'ongoing' } });
  });

  it('a stay request is incomplete until both dates are picked', () => {
    const start = initialDetailsFor(stayRequest);
    expect(firstMissingRequiredField(stayRequest, start)?.key).toBe('check_in_date');
    expect(firstMissingRequiredField(stayRequest, { ...start, check_in_date: '2030-01-10' })?.key).toBe('check_out_date');
    expect(firstMissingRequiredField(stayRequest, { ...start, check_in_date: '2030-01-10', check_out_date: '2030-01-12' })).toBeNull();
  });

  it('shows trail fields only to trail walkers', () => {
    const visible = (details: Record<string, unknown>) =>
      stayRequest.filter((spec) => isFieldVisible(spec, details)).map((spec) => spec.key);
    expect(visible({ stay_purpose: 'travel_tourism' })).not.toContain('near_trail');
    expect(visible({ stay_purpose: 'trail_walk' })).toEqual(expect.arrayContaining(['near_trail', 'gear']));
  });
});

describe('kindForDirection', () => {
  it('picks the kind of the chosen direction, falling back to an "either" kind', () => {
    expect(kindForDirection(KINDS_BY_WORLD.housing!, 'give')?.slug).toBe('host_offer');
    expect(kindForDirection(KINDS_BY_WORLD.housing!, 'request')?.slug).toBe('stay_request');
    const either = { ...KINDS_BY_WORLD.time![0]!, slug: 'any', direction: 'either' as const };
    expect(kindForDirection([either], 'request')?.slug).toBe('any');
    expect(kindForDirection([], 'give')).toBeNull();
  });

  // G1 step 5: an organization's event is chosen explicitly, never the default offer.
  it('never defaults to the organization event kind', () => {
    expect(kindForDirection(KINDS_BY_WORLD.time!, 'give')?.slug).toBe('volunteer_shift');
    const eventOnly = KINDS_BY_WORLD.time!.filter((k) => k.slug === 'org_event');
    expect(kindForDirection(eventOnly, 'give')).toBeNull();
  });
});

describe('organization event fields (G1 step 5)', () => {
  const eventKind = KINDS_BY_WORLD.time!.find((k) => k.slug === 'org_event')!;
  const eventFields = fieldsForKind(eventKind);

  it('starts with automatic registration and needs both ends of the window', () => {
    const start = initialDetailsFor(eventFields);
    expect(start).toEqual({ registration_policy: 'automatic' });
    expect(firstMissingRequiredField(eventFields, start)?.key).toBe('starts_at');
    expect(firstMissingRequiredField(eventFields, { ...start, starts_at: '2030-01-01T10:00:00.000Z' })?.key).toBe('ends_at');
  });

  it('a filled event with its organization validates against the server schema', () => {
    const details = {
      ...detailsForSubmit(eventFields, {
        ...initialDetailsFor(eventFields),
        starts_at: '2030-01-01T10:00:00.000Z',
        ends_at: '2030-01-01T12:00:00.000Z',
        capacity: 30,
        address: '',
      }),
      org_id: '00000000-0000-0000-0000-000000000001',
    };
    expect(details).not.toHaveProperty('address');
    expect(validateListingDetails(eventKind.detailSchema, details)).toBeNull();
  });
});

describe('clampWholeNumber', () => {
  it('keeps typed digits within the range', () => {
    expect(clampWholeNumber('40', 1, 5000)).toBe(40);
    expect(clampWholeNumber('0', 1, 5000)).toBe(1);
    expect(clampWholeNumber('99999', 1, 5000)).toBe(5000);
  });
  it('clears the field when nothing numeric is typed', () => {
    expect(clampWholeNumber('', 1, 5000)).toBeUndefined();
    expect(clampWholeNumber('abc', 1, 5000)).toBeUndefined();
  });
});

describe('listing field specs — knowledge (#1630)', () => {
  const kinds = KINDS_BY_WORLD.knowledge!;
  it('covers every key the server schema requires: asked for, or filled by a default', () => {
    for (const k of kinds) {
      const schema = k.detailSchema as { required: string[] };
      const specs = fieldsForKind(k);
      for (const key of schema.required) {
        const spec = specs.find((s) => s.key === key)!;
        expect(spec.required === true || ('defaultValue' in spec && spec.defaultValue !== undefined)).toBe(true);
      }
    }
  });

  it('offers a course to give and a mentorship request to ask for', () => {
    expect(kindForDirection(kinds, 'give')?.slug).toBe('course');
    expect(kindForDirection(kinds, 'request')?.slug).toBe('mentorship_request');
  });

  it('defaults to a single available slot', () => {
    const slots = fieldsForKind(kinds[0]!).find((s) => s.key === 'slots_available');
    expect(slots).toMatchObject({ type: 'count', min: 1, defaultValue: 1 });
  });
});

describe('listing field specs — animals (#1625)', () => {
  const kinds = KINDS_BY_WORLD.animals!;

  it('fills every key the server schema requires, by asking or by a default', () => {
    for (const k of kinds) {
      const schema = k.detailSchema as { required: string[] };
      const specs = fieldsForKind(k);
      for (const key of schema.required) {
        const spec = specs.find((s) => s.key === key)!;
        expect(spec.required === true || ('defaultValue' in spec && spec.defaultValue !== undefined)).toBe(true);
      }
    }
  });

  it('lets a member pick between handing an animal over and boarding, in either direction', () => {
    expect(kindChoices(kinds, 'give').map((k) => k.slug)).toEqual(['adoption_offer', 'foster_offer']);
    expect(kindChoices(kinds, 'request').map((k) => k.slug)).toEqual(['adoption_request', 'foster_request']);
  });

  it('offers full boarding, part-time boarding and pet-sitting', () => {
    const careMode = fieldsForKind(kinds.find((k) => k.slug === 'foster_offer')!).find((s) => s.key === 'care_mode');
    expect(careMode).toMatchObject({ type: 'choice', options: ['full_boarding', 'part_time', 'pet_sitting'] });
  });

  it('a boarding offer starts from sensible defaults and submits them', () => {
    const specs = fieldsForKind(kinds.find((k) => k.slug === 'foster_offer')!);
    expect(detailsForSubmit(specs, initialDetailsFor(specs))).toEqual({
      species: 'dog', care_mode: 'part_time', location_mode: 'either',
    });
  });

  it('a knowledge course and a private lesson are both offered to give', () => {
    expect(kindChoices(KINDS_BY_WORLD.knowledge!, 'give').map((k) => k.slug)).toEqual(['course', 'private_lesson']);
    expect(kindChoices(KINDS_BY_WORLD.knowledge!, 'request').map((k) => k.slug)).toEqual(['mentorship_request']);
  });

  it('keeps an organization event out of the choices', () => {
    const event = { kindId: 'k-event', slug: ORG_EVENT_KIND_SLUG, labelHe: 'e', labelEn: 'e', direction: 'give' as const, detailSchema: {} };
    expect(kindChoices([...KINDS_BY_WORLD.time!, event], 'give').map((k) => k.slug)).not.toContain(ORG_EVENT_KIND_SLUG);
  });
});
