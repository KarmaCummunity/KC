// Mapped to spec: docs/spec/05_giving_worlds.md (animals) · binding schemas in migration 0612.
// Curated create-form field sets of the four animals kinds: handing an animal over or looking to
// adopt one, and full boarding, part-time boarding or pet-sitting offered or asked for.
import type { ListingFieldSpec } from './listingFieldSpecs';

const SPECIES = ['dog', 'cat', 'rabbit', 'bird', 'rodent', 'reptile', 'other'] as const;
const AGE_GROUPS = ['young', 'adult', 'senior'] as const;
const SIZES = ['small', 'medium', 'large'] as const;
const CARE_MODES = ['full_boarding', 'part_time', 'pet_sitting'] as const;
const LOCATION_MODES = ['my_home', 'owner_home', 'either'] as const;

const SPECIES_FIELD: ListingFieldSpec = { key: 'species', type: 'choice', required: true, options: SPECIES, defaultValue: 'dog' };
const CARE_MODE_FIELD: ListingFieldSpec = { key: 'care_mode', type: 'choice', required: true, options: CARE_MODES, defaultValue: 'part_time' };
const LOCATION_FIELD: ListingFieldSpec = { key: 'location_mode', type: 'choice', options: LOCATION_MODES, defaultValue: 'either' };

/** Animals kinds keyed by `listing_kinds.slug`; spread into the kit's SPECS_BY_KIND. */
export const ANIMALS_FIELD_SPECS: Readonly<Record<string, readonly ListingFieldSpec[]>> = {
  adoption_offer: [
    SPECIES_FIELD,
    { key: 'age_group', type: 'choice', options: AGE_GROUPS },
    { key: 'sex', type: 'choice', options: ['male', 'female'] },
    { key: 'size', type: 'choice', options: SIZES },
    { key: 'vaccinated', type: 'toggle' },
    { key: 'neutered', type: 'toggle' },
    { key: 'good_with', type: 'multiChoice', options: ['children', 'dogs', 'cats'] },
  ],
  adoption_request: [
    SPECIES_FIELD,
    { key: 'age_group', type: 'choice', options: AGE_GROUPS },
    { key: 'size', type: 'choice', options: SIZES },
  ],
  foster_offer: [
    SPECIES_FIELD,
    CARE_MODE_FIELD,
    LOCATION_FIELD,
    { key: 'duration_days', type: 'integer', min: 1, max: 90 },
  ],
  foster_request: [
    SPECIES_FIELD,
    CARE_MODE_FIELD,
    LOCATION_FIELD,
    { key: 'starts_on', type: 'date' },
    { key: 'ends_on', type: 'date' },
  ],
};
