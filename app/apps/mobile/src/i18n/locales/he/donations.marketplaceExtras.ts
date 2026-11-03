// Hebrew — marketplace world labels + external-organisation picker copy.
// Extracted from `donations.ts` (300-LOC cap). Composed into `marketplace.world` / `marketplace.orgPicker`.

export const marketplaceWorldLabels = {
  money: 'כסף',
  time: 'זמן',
  items: 'חפצים',
  food: 'מזון',
  rides: 'נסיעות',
  housing: 'דיור',
  knowledge: 'ידע',
  medical: 'דם ורפואה',
  animals: 'חיות',
  environment: 'סביבה',
  creative: 'יצירה',
  app_design: 'עיצוב אפליקציות',
  romantic_matchmaking: 'שידוכים',
} as const;

/** Hub browse refinements (KC#1102 / KC#1111): world subcategory and distance from home. */
export const marketplaceBrowseRefine = {
  subcategoryRowA11y: 'סינון לפי קטגוריה',
  allSubcategories: 'כל הקטגוריות',
  radiusRowA11y: 'מרחק מהבית',
  radius: 'עד {{km}} ק״מ',
} as const;
