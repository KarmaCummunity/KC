// English — employment field and option labels (job offer and job request, first slice).
// Spread into `marketplace.field` / `marketplace.option` by donations.marketplaceFields.ts.

export const employmentFieldLabels = {
  job_role: 'Role',
  job_scope: 'Scope',
  job_area: 'Area',
} as const;

export const employmentOptionLabels = {
  job_full_time: 'Full-time',
  job_part_time: 'Part-time',
  job_shifts: 'Shifts',
  job_freelance: 'Freelance',
  job_temporary: 'Temporary',
} as const;
