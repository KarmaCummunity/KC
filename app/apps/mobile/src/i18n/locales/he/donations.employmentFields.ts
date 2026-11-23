// Hebrew — employment field and option labels (job offer, job request; #2278, #2537).
// Spread into `marketplace.field` / `marketplace.option` by donations.marketplaceFields.ts.

export const employmentFieldLabels = {
  role: 'תפקיד',
  job_scope: 'היקף משרה',
  work_mode: 'מקום העבודה',
  job_requirements: 'דרישות משרה',
  estimated_salary_min: 'שכר משוער',
  estimated_salary_max: 'עד (רשות)',
  salary_pay_period: 'תקופת שכר',
} as const;

export const employmentOptionLabels = {
  job_full_time: 'משרה מלאה',
  job_part_time: 'משרה חלקית',
  job_hourly: 'לפי שעות',
  job_freelance: 'פרילנס',
  on_site: 'במקום העבודה',
  remote: 'מהבית',
  hybrid: 'היברידי',
  pay_hourly: 'לשעה',
  pay_monthly: 'לחודש',
} as const;
