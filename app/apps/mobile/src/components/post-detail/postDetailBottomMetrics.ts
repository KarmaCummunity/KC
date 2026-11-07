import { spacing } from '@kc/ui';
import { BUTTON_HEIGHT } from '../ui/buttonStyles';

/** Compact owner primary action (`md`) + chrome vertical padding. */
export const POST_DETAIL_OWNER_BAR_PX = BUTTON_HEIGHT.md + spacing.sm * 2;

/** Single-line comment row height inside the bottom chrome. */
export const POST_DETAIL_COMPOSER_ROW_PX = 44;

/** Extra padding inside the unified bottom chrome (top/bottom). */
export const POST_DETAIL_CHROME_VERTICAL_PX = spacing.sm * 2;

/** Floating pill CTA (contact poster / join challenge) above the tab bar. */
export const POST_DETAIL_FLOATING_CTA_RESERVE_PX = 72;

/** @deprecated Use `postDetailScrollBottomInset` for accurate stacked chrome. */
export const POST_ENGAGEMENT_COMPOSER_RESERVE_PX =
  POST_DETAIL_COMPOSER_ROW_PX + POST_DETAIL_CHROME_VERTICAL_PX;

export type PostDetailBottomStack = Readonly<{
  tabBarOverlayInset: number;
  hasOwnerBar?: boolean;
  hasComposer?: boolean;
  floatingCtaReserve?: number;
}>;

/** Scroll padding so content clears tab bar + docked bottom chrome + optional floating pill. */
export function postDetailScrollBottomInset(stack: PostDetailBottomStack): number {
  const {
    tabBarOverlayInset,
    hasOwnerBar = false,
    hasComposer = false,
    floatingCtaReserve = 0,
  } = stack;
  let reserve = tabBarOverlayInset + spacing.lg;
  if (hasOwnerBar || hasComposer) {
    reserve += POST_DETAIL_CHROME_VERTICAL_PX;
  }
  if (hasOwnerBar) reserve += POST_DETAIL_OWNER_BAR_PX;
  if (hasComposer) reserve += POST_DETAIL_COMPOSER_ROW_PX + spacing.xs;
  reserve += floatingCtaReserve;
  return reserve;
}
