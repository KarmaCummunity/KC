// Miscellaneous chrome strings that don't belong to a single feature domain:
// the root error boundary fallback, the DEV environment banner, and the
// generic "more actions" menu accessibility label used by row-level overflow
// buttons (donation links, etc.).

export const errorBoundaryEn = {
  title: 'Something went wrong',
  body: 'You can try again or refresh the app.',
  retry: 'Try again',
} as const;

export const devBannerEn = 'Development environment · DEV — not production';

export const optionsMenuEn = {
  more: 'More options',
  default: 'Options',
} as const;
