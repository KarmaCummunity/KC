// Hebrew — employment field and option labels (job offer, job request; #2278).
// Spread into `marketplace.field` / `marketplace.option` by donations.marketplaceFields.ts.

export const employmentFieldLabels = {
  role: 'תפקיד',
  job_scope: 'היקף משרה',
  work_mode: 'מקום העבודה',
} as const;

export const employmentOptionLabels = {
  job_full_time: 'משרה מלאה',
  job_part_time: 'משרה חלקית',
  job_hourly: 'לפי שעות',
  job_freelance: 'פרילנס',
  on_site: 'במקום העבודה',
  remote: 'מהבית',
  hybrid: 'היברידי',
} as const;
