import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { typography, spacing, radius, type ColorPalette } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

// Style map consumed by react-native-markdown-display.
// Keys come from the library's internal renderer node names.
//
// Hebrew RTL notes:
//   - Every text-bearing node needs both `textAlign: rtlTextAlignStart` and
//     `writingDirection: 'rtl'`. The helper resolves to physical `left` on
//     native (which mirrors to inline-start under `I18nManager.forceRTL(true)`)
//     and physical `right` on web (where `dir="rtl"` makes `right` the
//     inline-start edge). Hard-coding a physical text edge on native lands
//     text on the *end* edge — visually LEFT — which produced the misaligned
//     Hebrew bodies users hit in the FR-SETTINGS-010 review.
//   - `writingDirection: 'rtl'` is still needed: it nails RTL bidi rendering
//     on iOS for mixed Hebrew/Latin runs (URLs, "GDPR", emails).
//   - `list_item` uses the shared `rowDirectionStart` (native='row',
//     web='row-reverse'). Writing 'row-reverse' directly on native is a
//     *double flip* under I18nManager.forceRTL and lands the bullet on
//     the LEFT.
//   - List-icon spacing uses logical `marginEnd` so the gap always sits
//     between the bullet (start edge) and the body (after it), regardless
//     of platform.
//   - Most of these styles are overridden by the custom render rules in
//     `legalMarkdownRules.tsx` (the library strips text props from its View
//     wrappers), but we keep them in sync so any node the rules don't
//     override still renders RTL.
export function makeLegalMarkdownStyles(colors: ColorPalette) {
  return StyleSheet.create({
    body: {
      ...typography.body,
      color: colors.textPrimary,
      writingDirection: 'rtl',
      textAlign: rtlTextAlignStart,
    } as TextStyle,
    paragraph: {
      ...typography.body,
      color: colors.textPrimary,
      marginBottom: spacing.md,
      writingDirection: 'rtl',
      textAlign: rtlTextAlignStart,
      lineHeight: 26,
    } as TextStyle,
    heading1: {
      ...typography.h2,
      color: colors.textPrimary,
      marginTop: spacing.lg,
      marginBottom: spacing.md,
      writingDirection: 'rtl',
      textAlign: rtlTextAlignStart,
    } as TextStyle,
    heading2: {
      ...typography.h3,
      color: colors.textPrimary,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
      writingDirection: 'rtl',
      textAlign: rtlTextAlignStart,
    } as TextStyle,
    heading3: {
      ...typography.h4,
      color: colors.textPrimary,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      writingDirection: 'rtl',
      textAlign: rtlTextAlignStart,
    } as TextStyle,
    link: {
      color: colors.primary,
      textDecorationLine: 'underline',
      writingDirection: 'rtl',
    } as TextStyle,
    list_item: {
      flexDirection: rowDirectionStart,
      marginBottom: spacing.sm,
    } as ViewStyle,
    bullet_list_icon: {
      ...typography.body,
      color: colors.textSecondary,
      marginStart: 0,
      marginEnd: spacing.sm,
      writingDirection: 'rtl',
    } as TextStyle,
    ordered_list_icon: {
      ...typography.body,
      color: colors.textSecondary,
      marginStart: 0,
      marginEnd: spacing.sm,
      writingDirection: 'rtl',
    } as TextStyle,
    bullet_list_content: {
      flex: 1,
      writingDirection: 'rtl',
      textAlign: rtlTextAlignStart,
    } as TextStyle,
    ordered_list_content: {
      flex: 1,
      writingDirection: 'rtl',
      textAlign: rtlTextAlignStart,
    } as TextStyle,
    blockquote: {
      backgroundColor: colors.surfaceRaised,
      // Logical border: lands on inline-start (right in RTL) on both platforms.
      borderStartWidth: 3,
      borderStartColor: colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginVertical: spacing.sm,
      borderRadius: radius.xs,
    } as ViewStyle,
    strong: {
      ...typography.body,
      ...typography.bold,
      writingDirection: 'rtl',
    } as TextStyle,
    em: {
      ...typography.body,
      fontStyle: 'italic',
      writingDirection: 'rtl',
    } as TextStyle,
  });
}
