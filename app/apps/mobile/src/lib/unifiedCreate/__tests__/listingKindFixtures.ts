// Listing kinds of the four listing create worlds, with the detail schemas the dev database
// holds (migrations 0241, 0321, 0381, 0391, 0563). Shared by the field-spec and form tests.
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
    }, ['expires_at'])), // food_type left `required` in 0700 ({{D:food-type-is-subcategory}}).
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
    // Binding stay schemas of migration 0600 (FR-HOUSING-005 / 006), trimmed to the keys and enums the form uses.
    kind('host_offer', 'give', obj({
      place_type: { enum: ['private_room', 'shared_room', 'couch', 'whole_unit', 'secondary_unit', 'tent_pitch'] },
      capacity: { type: 'integer' },
      exclusive: { type: 'boolean' },
      min_nights: { type: 'integer' },
      max_nights: { type: 'integer' },
      check_in_from: { type: 'string' },
      check_in_until: { type: 'string' },
      check_out_by: { type: 'string' },
      guest_policy: { enum: ['any', 'women_only', 'men_only', 'families_only', 'couples_and_families'] },
      children_ok: { type: 'boolean' },
      pets_ok: { type: 'boolean' },
      smoking: { enum: ['no', 'outside_only', 'yes'] },
      household: { type: 'array', items: { type: 'string' } },
      amenities: { type: 'array', items: { type: 'string' } },
      accessibility: { type: 'array', items: { type: 'string' } },
      house_rules: { type: 'string' },
      availability: { type: 'object' },
    })),
    kind('stay_request', 'request', obj({
      stay_purpose: { enum: ['trail_walk', 'travel_tourism', 'family_visit', 'medical_companion', 'study_exam', 'work_trip', 'evacuation', 'other'] },
      check_in_date: { type: 'string', format: 'date' },
      check_out_date: { type: 'string', format: 'date' },
      flexible_days: { type: 'integer' },
      adults: { type: 'integer' },
      minors: { type: 'integer' },
      needs: { type: 'array', items: { type: 'string' } },
      near_trail: { enum: ['israel_national_trail', 'jerusalem_trail', 'kinneret_trail', 'golan_trail', 'other_trail'] },
      gear: { type: 'array', items: { type: 'string' } },
    })),
  ],
  animals: [
    // Binding schemas of migration 0612 (adoption and boarding / pet-sitting, offers and requests).
    kind('adoption_offer', 'give', obj({
      species: { enum: ['dog', 'cat', 'rabbit', 'bird', 'rodent', 'reptile', 'other'] },
      age_group: { enum: ['young', 'adult', 'senior'] },
      sex: { enum: ['male', 'female'] },
      size: { enum: ['small', 'medium', 'large'] },
      vaccinated: { type: 'boolean' },
      neutered: { type: 'boolean' },
      good_with: { type: 'array', items: { enum: ['children', 'dogs', 'cats'] } },
    }, ['species'])),
    kind('adoption_request', 'request', obj({
      species: { enum: ['dog', 'cat', 'rabbit', 'bird', 'rodent', 'reptile', 'other'] },
      age_group: { enum: ['young', 'adult', 'senior'] },
      size: { enum: ['small', 'medium', 'large'] },
    }, ['species'])),
    kind('foster_offer', 'give', obj({
      species: { enum: ['dog', 'cat', 'rabbit', 'bird', 'rodent', 'reptile', 'other'] },
      care_mode: { enum: ['full_boarding', 'part_time', 'pet_sitting'] },
      location_mode: { enum: ['my_home', 'owner_home', 'either'] },
      duration_days: { type: 'integer', minimum: 1, maximum: 90 },
    }, ['species', 'care_mode'])),
    kind('foster_request', 'request', obj({
      species: { enum: ['dog', 'cat', 'rabbit', 'bird', 'rodent', 'reptile', 'other'] },
      care_mode: { enum: ['full_boarding', 'part_time', 'pet_sitting'] },
      location_mode: { enum: ['my_home', 'owner_home', 'either'] },
      starts_on: { type: 'string', format: 'date' },
      ends_on: { type: 'string', format: 'date' },
    }, ['species', 'care_mode'])),
  ],
  knowledge: [
    // Binding schemas of migration 0395, trimmed to the keys and enums the form uses.
    kind('course', 'give', obj({
      topic: { type: 'string', minLength: 2, maxLength: 80 },
      level: { enum: ['beginner', 'intermediate', 'advanced'] },
      modality: { enum: ['in_person', 'video', 'phone'] },
      slot_starts_at: { type: 'string', format: 'date-time' },
      slot_ends_at: { type: 'string', format: 'date-time' },
      slots_available: { type: 'integer', minimum: 1, maximum: 50 },
      requires_org_approval: { type: 'boolean' },
    }, ['topic', 'modality', 'slot_starts_at', 'slot_ends_at', 'slots_available'])),
    kind('private_lesson', 'give', obj({
      topic: { type: 'string', minLength: 2, maxLength: 80 },
      level: { enum: ['beginner', 'intermediate', 'advanced'] },
      modality: { enum: ['in_person', 'video', 'phone'] },
      slot_starts_at: { type: 'string', format: 'date-time' },
      slot_ends_at: { type: 'string', format: 'date-time' },
      slots_available: { type: 'integer', minimum: 1, maximum: 20 },
      availability_note: { type: 'string', maxLength: 280 },
    }, ['topic', 'modality', 'slot_starts_at', 'slot_ends_at', 'slots_available'])),
    kind('mentorship_request', 'request', obj({
      topic: { type: 'string', minLength: 2, maxLength: 80 },
      level: { type: 'string' },
      preferred_modality: { enum: ['in_person', 'video', 'phone'] },
    }, ['topic'])),
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
    // An organization's event (0563), offered only to members of an organization.
    kind('org_event', 'give', obj({
      org_id: { type: 'string', minLength: 36, maxLength: 36 },
      starts_at: { type: 'string', format: 'date-time' },
      ends_at: { type: 'string', format: 'date-time' },
      capacity: { type: 'integer', minimum: 1, maximum: 5000 },
      registration_policy: { enum: ['automatic', 'manual', 'verified_only'] },
      address: { type: 'string', minLength: 2, maxLength: 160 },
    }, ['org_id', 'starts_at', 'ends_at', 'registration_policy'])),
  ],
};
