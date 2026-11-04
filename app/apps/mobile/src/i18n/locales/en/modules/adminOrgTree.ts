// FR-ADMIN-025 — hierarchy tree cards: report count, section count, expand and collapse labels.
export const adminOrgTreeEn = {
  reports: (n: number) => (n === 1 ? '1 report' : `${n} reports`),
  members: (n: number) => (n === 1 ? '1 team member' : `${n} team members`),
  expand: 'Show reports',
  collapse: 'Hide reports',
};
