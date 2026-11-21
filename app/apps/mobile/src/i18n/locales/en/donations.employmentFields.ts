// English — employment field and option labels (job offer, job request; #2278, #2537).
// Spread into `marketplace.field` / `marketplace.option` by donations.marketplaceFields.ts.

export const employmentFieldLabels = {
  role: 'Role',
  job_scope: 'Scope',
  work_mode: 'Where',
  job_requirements: 'Job requirements',
  estimated_salary_min: 'Estimated salary',
  estimated_salary_max: 'Up to (optional)',
  salary_pay_period: 'Pay period',
} as const;

export const employmentOptionLabels = {
  job_full_time: 'Full time',
  job_part_time: 'Part time',
  job_hourly: 'Hourly',
  job_freelance: 'Freelance',
  on_site: 'On site',
  remote: 'Remote',
  hybrid: 'Hybrid',
  pay_hourly: 'Hourly',
  pay_monthly: 'Monthly',
} as const;
