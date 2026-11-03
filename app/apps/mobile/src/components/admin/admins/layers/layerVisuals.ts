// app/apps/mobile/src/components/admin/admins/layers/layerVisuals.ts
// FR-ADMIN-028 — visual language of the layered hierarchy view.
//
// The number of levels follows the reporting chain, so every visual is derived
// from a level's position rather than looked up per fixed stratum: bands widen
// from the top level to the base (a pyramid on wide screens, a gentle inset on
// phones), accents walk a ramp by depth, and the icon names the top role.
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { AdminRole } from '@kc/domain';
import { avatarPalette } from '@kc/ui';

export type LayerIconName = ComponentProps<typeof Ionicons>['name'];

/** Icon per role; a band shows the icon of its highest role. Exhaustive by type. */
export const ROLE_ICON: Readonly<Record<AdminRole, LayerIconName>> = {
  super_admin:       'shield-checkmark',
  moderator:         'construct',
  support:           'chatbubbles',
  operators_manager: 'headset',
  operator:          'call',
  org_admin:         'business',
  org_manager:       'people',
  volunteer_manager: 'hand-left',
  org_employee:      'briefcase',
  org_volunteer:     'heart',
};

/**
 * Categorical colours come from the brand's theme-independent palette (spec 17
 * §4: admin screens introduce no colours of their own). Every entry meets AA
 * against white, so text and glyphs drawn on them stay legible.
 */
const CATEGORICAL: readonly string[] = avatarPalette.backgrounds;

/** Colour at `index`, cycling through the palette. */
function categorical(index: number): string {
  return CATEGORICAL[index % CATEGORICAL.length] ?? avatarPalette.backgrounds[0];
}

/** Accent of a level; levels deeper than the palette reuse it from the start. */
export function layerAccent(level: number): string {
  return categorical(level);
}

/** Narrowest band width on wide screens, as a percentage of the column. */
const TOP_BAND_PCT = 50;

/** Wide-screen width of the band at `index` of `total`, growing linearly to 100%. */
export function layerWidePct(index: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round(TOP_BAND_PCT + ((100 - TOP_BAND_PCT) * (index + 1)) / total);
}

/** Phone indent per step up from the base, in px. */
const PHONE_TAPER_STEP = 6;
/** Indent cap, so a deep chain never squeezes the top bands on a phone. */
const PHONE_TAPER_MAX_STEPS = 5;

/** Phone horizontal inset of the band at `index` of `total` (top band most inset). */
export function layerPhoneInset(index: number, total: number): number {
  return Math.min(total - index, PHONE_TAPER_MAX_STEPS) * PHONE_TAPER_STEP;
}

/**
 * Stable accent per org. The platform org wears the brand colour; other orgs
 * take palette hues in census order (platform first, then by name), so the
 * same org keeps its colour while the list is unchanged.
 */
export function buildOrgAccents(
  orgs: readonly { readonly orgId: string; readonly isPlatform: boolean }[],
  brand: string,
): ReadonlyMap<string, string> {
  const accents = new Map<string, string>();
  // Palette slot 0 is the brand orange, which the platform org already wears.
  let next = 1;
  for (const org of orgs) {
    if (org.isPlatform) {
      accents.set(org.orgId, brand);
    } else {
      accents.set(org.orgId, categorical(next));
      next += 1;
    }
  }
  return accents;
}
