// FR-POST-001 AC6 — each listing kind renders a curated, schema-safe field set: no internal
// keys, every key accepted by the server schema, defaults, required checks and submit cleanup.
import { describe, expect, it } from 'vitest';
import { validateListingDetails } from '@kc/domain';
import {
  detailsForSubmit,
  fieldsForKind,
  firstMissingRequiredField,
  initialDetailsFor,
  isFieldVisible,
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
    for (const internal of ['linked_listing_id', 'org_host_slug', 'fulfillment_mode', 'origin_lat', 'guest_scenario']) {
      expect(shown).not.toContain(internal);
    }
  });

  it('renders the purpose-built fields of each category (docs/spec/07 §7.2)', () => {
    expect(keysOf('give_food')).toEqual(['food_type', 'expires_at', 'allergens', 'kosher', 'pickup_mode']);
    expect(keysOf('request_food')).toEqual(['household_size', 'dietary_needs']);
    // Route, departure, estimated end and seats are rendered by RideCreateSection (D71, D75).
    expect(keysOf('ride_offer')).toEqual(['reward_model', 'cost_share_ils']);
    expect(keysOf('ride_request')).toEqual(['passengers', 'luggage']);
    expect(keysOf('host_offer')).toEqual(['place_type', 'capacity', 'house_rules']);
    expect(keysOf('stay_request')).toEqual(['party_size']);
    expect(keysOf('volunteer_shift')).toEqual(['duration_minutes']);
    expect(keysOf('support_request')).toEqual(['support_type', 'duration_minutes']);
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

  it('shows the cost-share amount only for an expense-sharing ride', () => {
    const amount = rideOffer.find((s) => s.key === 'cost_share_ils')!;
    expect(isFieldVisible(amount, { reward_model: 'free' })).toBe(false);
    expect(isFieldVisible(amount, { reward_model: 'expense_share' })).toBe(true);
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

describe('kindForDirection', () => {
  it('picks the kind of the chosen direction, falling back to an "either" kind', () => {
    expect(kindForDirection(KINDS_BY_WORLD.housing!, 'give')?.slug).toBe('host_offer');
    expect(kindForDirection(KINDS_BY_WORLD.housing!, 'request')?.slug).toBe('stay_request');
    const either = { ...KINDS_BY_WORLD.time![0]!, slug: 'any', direction: 'either' as const };
    expect(kindForDirection([either], 'request')?.slug).toBe('any');
    expect(kindForDirection([], 'give')).toBeNull();
  });
});
