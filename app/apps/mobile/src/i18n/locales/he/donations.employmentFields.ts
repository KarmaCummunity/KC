// Hebrew — employment field and option labels (job offer and job request, first slice).
// Spread into `marketplace.field` / `marketplace.option` by donations.marketplaceFields.ts.

export const employmentFieldLabels = {
  job_role: 'התפקיד',
  job_scope: 'היקף המשרה',
  job_area: 'אזור',
} as const;

export const employmentOptionLabels = {
  job_full_time: 'משרה מלאה',
  job_part_time: 'משרה חלקית',
  job_shifts: 'משמרות',
  job_freelance: 'עבודה עצמאית',
  job_temporary: 'זמנית',
} as const;
