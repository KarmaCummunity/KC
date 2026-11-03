// Listing kinds of the four listing create worlds, with the detail schemas the dev database
// holds (migrations 0241, 0321, 0381, 0391). Shared by the field-spec and form tests.
import type { ListingKindOption } from '@kc/domain';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});

const RIDE_ROUTE = {
  origin_label: { type: 'string', maxLength: 120 },
  dest_label: { type: 'string', maxLength: 120 },
  origin_city_id: { type: 'string' },
  dest_city_id: { type: 'string' },
  origin_lat: { type: 'number' },
  origin_lng: { type: 'number' },
  dest_lat: { type: 'number' },
  dest_lng: { type: 'number' },
  departs_at: { type: 'string', format: 'date-time' },
};

function kind(slug: string, direction: 'give' | 'request', schema: Record<string, unknown>): ListingKindOption {
  return { kindId: `k-${slug}`, slug, labelHe: slug, labelEn: slug, direction, detailSchema: schema };
}

export const KINDS_BY_WORLD: Readonly<Record<string, readonly ListingKindOption[]>> = {
  food: [
    kind('give_food', 'give', obj({
      food_type: { enum: ['cooked', 'packaged', 'fresh', 'frozen', 'dry', 'beverage'] },
      expires_at: { type: 'string', format: 'date-time' },
      allergens: { type: 'array', items: { type: 'string' } },
      kosher: { type: 'string' },
      dietary_tags: { type: 'array', items: { type: 'string' } },
      fulfillment_mode: { enum: ['fcfs', 'owner_approval'] },
      pickup_mode: { enum: ['pickup', 'delivery', 'either'] },
      delivery_available: { type: 'boolean' },
      pickup_window_start: { type: 'string', format: 'date-time' },
      pickup_window_end: { type: 'string', format: 'date-time' },
    }, ['expires_at', 'food_type'])),
    kind('request_food', 'request', obj({ household_size: { type: 'integer' }, dietary_needs: { type: 'string' } })),
  ],
  rides: [
    kind('ride_offer', 'give', obj({
      ...RIDE_ROUTE,
      seats_available: { type: 'integer' },
      cargo_items: { type: 'boolean' },
      cargo_food: { type: 'boolean' },
      reward_model: { enum: ['free', 'expense_share'] },
      cost_share_ils: { type: 'number', minimum: 0 },
      linked_listing_id: { type: 'string', format: 'uuid' },
    }, ['departs_at'])),
    kind('ride_request', 'request', obj({
      ...RIDE_ROUTE,
      passengers: { type: 'integer', minimum: 1, maximum: 8 },
      seats_available: { type: 'integer' },
      luggage: { type: 'boolean' },
      constraints: { type: 'string', maxLength: 280 },
    }, ['departs_at'])),
  ],
  housing: [
    kind('host_offer', 'give', obj({
      hosting_model: { enum: ['recurring_slot', 'open_spot', 'continuous'] },
      place_type: { type: 'string' },
      capacity: { type: 'integer' },
      amenities: { type: 'array', items: { type: 'string' } },
      house_rules: { type: 'string' },
    })),
    kind('stay_request', 'request', obj({
      guest_scenario: { enum: ['trail', 'homeless_emergency', 'regular'] },
      party_size: { type: 'integer' },
      gear: { type: 'string' },
    })),
  ],
  time: [
    kind('volunteer_shift', 'give', obj({
      duration_minutes: { type: 'integer' },
      skills: { type: 'array', items: { type: 'string' } },
      org_host_slug: { type: 'string' },
    })),
    kind('support_request', 'request', obj({
      support_type: { enum: ['emotional', 'companionship', 'practical', 'escort'] },
      duration_minutes: { type: 'integer' },
    })),
  ],
};
