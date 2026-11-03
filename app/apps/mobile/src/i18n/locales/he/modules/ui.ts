// Miscellaneous chrome strings that don't belong to a single feature domain:
// the root error boundary fallback, the DEV environment banner, and the
// generic "more actions" menu accessibility label used by row-level overflow
// buttons (donation links, etc.).

export const errorBoundaryHe = {
  title: 'משהו השתבש',
  body: 'אפשר לנסות שוב או לרענן את האפליקציה.',
  retry: 'לנסות שוב',
} as const;

export const devBannerHe = 'סביבת פיתוח · DEV — לא הפרודקשן';

export const optionsMenuHe = {
  more: 'אפשרויות נוספות',
  default: 'אפשרויות',
} as const;
