// Mapped to spec: docs/spec/05_giving_worlds.md §5.11 (employment, first slice).
// Curated create-form field sets of the two employment kinds: a job offered and a job sought.
// Both describe the role, the scope and the area; free-text detail goes in the description.
import type { ListingFieldSpec } from './listingFieldSpecs';

// Option values are prefixed `job_`: option labels are shared by value across worlds, and
// `part_time` already means "part-time boarding" in the animals world.
const JOB_SCOPES = ['job_full_time', 'job_part_time', 'job_shifts', 'job_freelance', 'job_temporary'] as const;

const ROLE_FIELD: ListingFieldSpec = { key: 'job_role', type: 'text', required: true, maxLength: 80 };
const SCOPE_FIELD: ListingFieldSpec = { key: 'job_scope', type: 'choice', required: true, options: JOB_SCOPES, defaultValue: 'job_full_time' };
const AREA_FIELD: ListingFieldSpec = { key: 'job_area', type: 'text', maxLength: 80 };

/** Employment kinds keyed by `post_kinds.slug`; spread into the kit's SPECS_BY_KIND. */
export const EMPLOYMENT_FIELD_SPECS: Readonly<Record<string, readonly ListingFieldSpec[]>> = {
  job_offer: [ROLE_FIELD, SCOPE_FIELD, AREA_FIELD],
  job_request: [ROLE_FIELD, SCOPE_FIELD, AREA_FIELD],
};
