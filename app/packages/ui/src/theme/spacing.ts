// ─────────────────────────────────────────────
// Spacing & Radius Tokens
// ─────────────────────────────────────────────

import { lightColors } from './colors';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
  '4xl': 64,
} as const;

/**
 * Shell layout dimensions used by AppShell, NavigationRail, AsidePanel.
 * Kept separate from `spacing` because these are layout sizes (rail widths,
 * content max-widths) rather than the gap-scale that `spacing` represents.
 */
export const shellDimensions = {
  railCollapsed: 60,
  railExpanded: 220,
  aside: 280,
  contentMaxWide: 720,
  contentMaxDesktop: 680,
  contentMaxTablet: 640,
  contentMaxNarrow: 600,
} as const;

/**
 * Corner radius scale (spec 17 §4, D67). 4-based steps that match the values
 * screens already used most (8 and 12), so token adoption causes no visual jump.
 * `full` renders a pill / circle at any size.
 */
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

/**
 * Elevation presets (spec 17 §4). `card` and `modal` are neutral (black)
 * shadows; `glow` is the brand-coloured lift under primary calls to action
 * (D87 — the offset, opacity, blur and elevation those buttons already used
 * most). `glow` carries the light-mode primary; theme-aware screens spread it
 * and override `shadowColor` with `colors.primary` from `useTheme()`.
 */
export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  glow: {
    shadowColor: lightColors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;
