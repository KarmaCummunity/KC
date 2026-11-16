// Mapped to spec: docs/spec/05_giving_worlds.md (employment) · #2278, the world's first slice.
// Curated create-form field sets of the two employment kinds: offering a job and looking for work.
// Option keys carry a `job_` prefix where a bare word (`part_time`) already names an animals option
// in the shared option labels (`marketplace.option`).
import type { ListingFieldSpec } from './listingFieldSpecs';

const JOB_SCOPES = ['job_full_time', 'job_part_time', 'job_hourly', 'job_freelance'] as const;
const WORK_MODES = ['on_site', 'remote', 'hybrid'] as const;

/** The role in a few words: it is the line a job seeker scans first. */
const ROLE_FIELD: ListingFieldSpec = { key: 'role', type: 'text', required: true, maxLength: 80 };

/** Employment kinds keyed by `post_kinds.slug`; spread into the kit's SPECS_BY_KIND. */
export const EMPLOYMENT_FIELD_SPECS: Readonly<Record<string, readonly ListingFieldSpec[]>> = {
  job_offer: [
    ROLE_FIELD,
    { key: 'job_scope', type: 'choice', required: true, options: JOB_SCOPES, defaultValue: 'job_full_time' },
    { key: 'work_mode', type: 'choice', options: WORK_MODES, defaultValue: 'on_site' },
  ],
  job_request: [
    ROLE_FIELD,
    { key: 'job_scope', type: 'choice', options: JOB_SCOPES },
    { key: 'work_mode', type: 'choice', options: WORK_MODES },
  ],
};
