import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { typography, spacing, radius, type ColorPalette } from '@kc/ui';
import {
  hebrewContentRightBorder,
  hebrewContentRowDirection,
  hebrewContentTextStyle,
} from '../../lib/hebrewContentDirection';

// Style map consumed by react-native-markdown-display.
// Keys come from the library's internal renderer node names.
//
// Legal document bodies are Hebrew-only (#1733), so every text node takes
// `hebrewContentTextStyle()` — RTL bidi aligned to the visual right in both the
// Hebrew and the English UI — and `list_item` takes `hebrewContentRowDirection()`
// so the bullet sits on the right. The row `gap` keeps the bullet spacing on the
// inner side in both layouts. Most of these styles are overridden by the custom
// render rules in `legalMarkdownRules.tsx` (the library strips text props from its
// View wrappers); they stay in sync so any node the rules don't override still
// renders RTL.
export function makeLegalMarkdownStyles(colors: ColorPalette) {
  const hebrew = hebrewContentTextStyle();
  return StyleSheet.create({
    body: {
      ...typography.body,
      color: colors.textPrimary,
      ...hebrew,
    } as TextStyle,
    paragraph: {
      ...typography.body,
      color: colors.textPrimary,
      marginBottom: spacing.md,
      ...hebrew,
      lineHeight: 26,
    } as TextStyle,
    heading1: {
      ...typography.h2,
      color: colors.textPrimary,
      marginTop: spacing.lg,
      marginBottom: spacing.md,
      ...hebrew,
    } as TextStyle,
    heading2: {
      ...typography.h3,
      color: colors.textPrimary,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
      ...hebrew,
    } as TextStyle,
    heading3: {
      ...typography.h4,
      color: colors.textPrimary,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      ...hebrew,
    } as TextStyle,
    link: {
      color: colors.primary,
      textDecorationLine: 'underline',
      ...hebrew,
    } as TextStyle,
    list_item: {
      flexDirection: hebrewContentRowDirection(),
      gap: spacing.sm,
      marginBottom: spacing.sm,
    } as ViewStyle,
    bullet_list_icon: {
      ...typography.body,
      color: colors.textSecondary,
      ...hebrew,
    } as TextStyle,
    ordered_list_icon: {
      ...typography.body,
      color: colors.textSecondary,
      ...hebrew,
    } as TextStyle,
    bullet_list_content: {
      flex: 1,
      ...hebrew,
    } as TextStyle,
    ordered_list_content: {
      flex: 1,
      ...hebrew,
    } as TextStyle,
    blockquote: {
      backgroundColor: colors.surfaceRaised,
      ...hebrewContentRightBorder(3, colors.primary),
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginVertical: spacing.sm,
      borderRadius: radius.xs,
    } as ViewStyle,
    strong: {
      ...typography.body,
      ...typography.bold,
      ...hebrew,
    } as TextStyle,
    em: {
      ...typography.body,
      fontStyle: 'italic',
      ...hebrew,
    } as TextStyle,
  });
}
