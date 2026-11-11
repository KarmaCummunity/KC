// Listing kinds of the four listing create worlds, with the detail schemas the dev database
// holds (migrations 0241, 0321, 0381, 0391, 0563, 0700, 0703). Shared by the field-spec and form tests.
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
    kind('food_offer', 'give', obj({
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
    }, ['expires_at'])), // food_type left `required` in 0700 (D137).
    kind('food_request', 'request', obj({ household_size: { type: 'integer' }, dietary_needs: { type: 'string' } })),
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
    // The six exchange kinds of migration 0703 (#2034), trimmed to the keys and enums the form uses.
    kind('lesson_offer', 'give', obj({
      topic: { type: 'string', minLength: 2, maxLength: 80 },
      level: { enum: ['beginner', 'intermediate', 'advanced'] },
      modality: { enum: ['in_person', 'video', 'phone'] },
      language: { type: 'array', items: { enum: ['he', 'en', 'ar', 'ru', 'am', 'fr', 'es', 'other'] } },
      capacity_per_slot: { type: 'integer', minimum: 1, maximum: 20 },
      slots: { type: 'array', minItems: 1, maxItems: 20 },
      availability_note: { type: 'string', maxLength: 280 },
      resource_ids: { type: 'array' },
    }, ['modality', 'capacity_per_slot', 'slots'])),
    kind('mentoring_offer', 'give', obj({
      topic: { type: 'string', minLength: 2, maxLength: 80 },
      level: { enum: ['beginner', 'intermediate', 'advanced'] },
      modality: { enum: ['in_person', 'video', 'phone'] },
      language: { type: 'array' },
      audience: { type: 'array', items: { enum: ['career_change', 'students', 'new_immigrants', 'youth_18plus', 'seniors', 'other'] } },
      cadence: { enum: ['weekly', 'biweekly', 'monthly', 'flexible'] },
      seats: { type: 'integer', minimum: 1, maximum: 10 },
      availability_note: { type: 'string', maxLength: 280 },
    }, ['cadence', 'seats', 'modality'])),
    kind('consulting_hour', 'give', obj({
      topic: { type: 'string', minLength: 2, maxLength: 80 },
      modality: { enum: ['in_person', 'video', 'phone'] },
      language: { type: 'array' },
      profession: { enum: ['lawyer', 'accountant', 'tax_advisor', 'social_worker', 'employment_rights', 'housing_rights', 'consumer_rights', 'other'] },
      capacity_per_slot: { type: 'integer', minimum: 1, maximum: 5 },
      slots: { type: 'array', minItems: 1, maxItems: 20 },
      availability_note: { type: 'string', maxLength: 280 },
      disclaimer_accepted: { const: true },
    }, ['profession', 'modality', 'capacity_per_slot', 'slots', 'disclaimer_accepted'])),
    kind('learning_request', 'request', obj({
      topic: { type: 'string', minLength: 2, maxLength: 80 },
      level: { enum: ['beginner', 'intermediate', 'advanced'] },
      preferred_modality: { enum: ['in_person', 'video', 'phone'] },
      language: { type: 'array' },
      availability_note: { type: 'string', maxLength: 280 },
    })),
    kind('mentoring_request', 'request', obj({
      topic: { type: 'string', minLength: 2, maxLength: 80 },
      level: { enum: ['beginner', 'intermediate', 'advanced'] },
      preferred_modality: { enum: ['in_person', 'video', 'phone'] },
      language: { type: 'array' },
      goal: { type: 'string', maxLength: 280 },
      cadence: { enum: ['weekly', 'biweekly', 'monthly', 'flexible'] },
    })),
    kind('question', 'request', obj({
      topic: { type: 'string', minLength: 2, maxLength: 80 },
      context_url: { type: 'string', maxLength: 500 },
    })),
  ],
  time: [
    kind('volunteer_offer', 'give', obj({
      duration_minutes: { type: 'integer' },
      skills: { type: 'array', items: { type: 'string' } },
      org_host_slug: { type: 'string' },
    })),
    kind('volunteer_request', 'request', obj({
      support_type: { enum: ['emotional', 'companionship', 'practical', 'escort'] },
      duration_minutes: { type: 'integer' },
    })),
    // An organization's event (0563), offered only to members of an organization.
    kind('event', 'give', obj({
      org_id: { type: 'string', minLength: 36, maxLength: 36 },
      starts_at: { type: 'string', format: 'date-time' },
      ends_at: { type: 'string', format: 'date-time' },
      capacity: { type: 'integer', minimum: 1, maximum: 5000 },
      registration_policy: { enum: ['automatic', 'manual', 'verified_only'] },
      address: { type: 'string', minLength: 2, maxLength: 160 },
    }, ['org_id', 'starts_at', 'ends_at', 'registration_policy'])),
  ],
};
