// FR-ADMIN-025 — hierarchy tree cards: report count, section count, expand and collapse labels.
export const adminOrgTreeHe = {
  reports: (n: number) => (n === 1 ? 'כפוף אחד' : `${n} כפופים`),
  members: (n: number) => (n === 1 ? 'איש צוות אחד' : `${n} אנשי צוות`),
  expand: 'הצגת כפופים',
  collapse: 'הסתרת כפופים',
};
