// Mapped to spec: FR-HOUSING-005 (stay offer fields), FR-HOUSING-006 (stay request fields),
// FR-HOUSING-011 (availability) — docs/spec/requirements/21_housing.md; binding schemas in migration 0600.
// Curated create-form field sets of the two housing stay kinds. Defaults match the spec so a
// host who only picks the place type and capacity still publishes a valid offer.
import type { ListingFieldSpec } from './listingFieldSpecs';

const PLACE_TYPES = ['private_room', 'shared_room', 'couch', 'whole_unit', 'secondary_unit', 'tent_pitch'] as const;

const HOST_OFFER: readonly ListingFieldSpec[] = [
  { key: 'place_type', type: 'choice', required: true, options: PLACE_TYPES, defaultValue: 'private_room' },
  { key: 'capacity', type: 'count', min: 1, max: 20, defaultValue: 2 },
  // A shared room or a couch is never exclusive (server rule `housing_details_invalid`).
  { key: 'exclusive', type: 'toggle', defaultValue: false },
  { key: 'min_nights', type: 'count', min: 1, max: 30, defaultValue: 1 },
  { key: 'max_nights', type: 'count', min: 1, max: 30, defaultValue: 3 },
  { key: 'check_in_from', type: 'time', required: true, defaultValue: '16:00' },
  { key: 'check_in_until', type: 'time', required: true, defaultValue: '22:00' },
  { key: 'check_out_by', type: 'time', required: true, defaultValue: '10:00' },
  {
    key: 'guest_policy',
    type: 'choice',
    required: true,
    options: ['any', 'women_only', 'men_only', 'families_only', 'couples_and_families'],
    defaultValue: 'any',
  },
  { key: 'children_ok', type: 'toggle', defaultValue: true },
  { key: 'pets_ok', type: 'toggle', defaultValue: false },
  { key: 'smoking', type: 'choice', required: true, options: ['no', 'outside_only', 'yes'], defaultValue: 'no' },
  {
    key: 'amenities',
    type: 'multiChoice',
    options: ['shower', 'hot_water', 'kitchen', 'laundry', 'wifi', 'heating', 'ac', 'parking', 'bedding', 'towels',
      'electricity', 'drinking_water', 'toilet', 'safe_room'],
  },
  { key: 'accessibility', type: 'multiChoice', options: ['step_free_entry', 'elevator', 'accessible_bathroom', 'ground_floor'] },
  {
    key: 'household',
    type: 'multiChoice',
    options: ['kosher_kitchen', 'shabbat_observant', 'vegetarian_kitchen', 'pets_in_home', 'kids_in_home'],
  },
  { key: 'house_rules', type: 'text', multiline: true, maxLength: 300 },
  // Open-ended availability until the availability editor (window / weekly / blackout) ships.
  { key: 'availability', type: 'fixed', defaultValue: { mode: 'ongoing' } },
];

const STAY_REQUEST: readonly ListingFieldSpec[] = [
  {
    key: 'stay_purpose',
    type: 'choice',
    required: true,
    options: ['trail_walk', 'travel_tourism', 'family_visit', 'medical_companion', 'study_exam', 'work_trip', 'other'],
    defaultValue: 'travel_tourism',
  },
  { key: 'check_in_date', type: 'date', required: true },
  { key: 'check_out_date', type: 'date', required: true },
  { key: 'flexible_days', type: 'count', min: 0, max: 3, defaultValue: 0 },
  { key: 'adults', type: 'count', min: 1, max: 8, defaultValue: 1 },
  { key: 'minors', type: 'count', min: 0, max: 7, defaultValue: 0 },
  {
    key: 'near_trail',
    type: 'choice',
    options: ['israel_national_trail', 'jerusalem_trail', 'kinneret_trail', 'golan_trail', 'other_trail'],
    visibleWhen: { key: 'stay_purpose', equals: 'trail_walk' },
  },
  {
    key: 'gear',
    type: 'multiChoice',
    options: ['tent', 'sleeping_bag', 'mat'],
    visibleWhen: { key: 'stay_purpose', equals: 'trail_walk' },
  },
  { key: 'needs', type: 'multiChoice', options: ['step_free_entry', 'accessible_bathroom', 'kosher_kitchen', 'pets', 'parking', 'quiet'] },
];

/** Housing stay kinds keyed by `listing_kinds.slug`; spread into the kit's SPECS_BY_KIND. */
export const HOUSING_FIELD_SPECS: Readonly<Record<string, readonly ListingFieldSpec[]>> = {
  host_offer: HOST_OFFER,
  stay_request: STAY_REQUEST,
};
