// Mapped to spec: docs/spec/05_giving_worlds.md (employment) · #2278, #2537.
// Curated create-form field sets of the two employment kinds: offering a job and looking for work.
// Option keys carry a `job_` / `pay_` prefix where a bare word already names another world's option
// in the shared option labels (`marketplace.option`).
import {
  ESTIMATED_SALARY_MAX_ILS,
  JOB_REQUIREMENTS_MAX_LENGTH,
  SALARY_PAY_PERIODS,
} from '@kc/domain';
import type { ListingFieldSpec } from './listingFieldSpecs';

const JOB_SCOPES = ['job_full_time', 'job_part_time', 'job_hourly', 'job_freelance'] as const;
const WORK_MODES = ['on_site', 'remote', 'hybrid'] as const;

/** The role in a few words: it is the line a job seeker scans first. */
const ROLE_FIELD: ListingFieldSpec = { key: 'role', type: 'text', required: true, maxLength: 80 };

/** Shared optional fields of a job offer: requirements and estimated salary (#2537). */
const JOB_OFFER_EXTRA_FIELDS: readonly ListingFieldSpec[] = [
  { key: 'job_requirements', type: 'text', multiline: true, maxLength: JOB_REQUIREMENTS_MAX_LENGTH },
  // Min alone is a single amount; min + max is a range. Both optional.
  { key: 'estimated_salary_min', type: 'amount', max: ESTIMATED_SALARY_MAX_ILS },
  { key: 'estimated_salary_max', type: 'amount', max: ESTIMATED_SALARY_MAX_ILS },
  { key: 'salary_pay_period', type: 'choice', options: SALARY_PAY_PERIODS },
];

/** Employment kinds keyed by `post_kinds.slug`; spread into the kit's SPECS_BY_KIND. */
export const EMPLOYMENT_FIELD_SPECS: Readonly<Record<string, readonly ListingFieldSpec[]>> = {
  job_offer: [
    ROLE_FIELD,
    { key: 'job_scope', type: 'choice', required: true, options: JOB_SCOPES, defaultValue: 'job_full_time' },
    { key: 'work_mode', type: 'choice', options: WORK_MODES, defaultValue: 'on_site' },
    ...JOB_OFFER_EXTRA_FIELDS,
  ],
  job_request: [
    ROLE_FIELD,
    { key: 'job_scope', type: 'choice', options: JOB_SCOPES },
    { key: 'work_mode', type: 'choice', options: WORK_MODES },
  ],
};
