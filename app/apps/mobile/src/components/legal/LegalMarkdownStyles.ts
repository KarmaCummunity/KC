import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { typography, spacing, radius, type ColorPalette } from '@kc/ui';
import {
  hebrewContentRightBorder,
  hebrewContentRowDirection,
  hebrewContentTextStyle,
} from '../../lib/hebrewContentDirection';

/**
 * Style map for the in-house legal Markdown renderer (`LegalMarkdown`).
 *
 * Legal document bodies are Hebrew-only (#1733), so every text node takes
 * `hebrewContentTextStyle()` — RTL bidi aligned to the visual right in both the
 * Hebrew and the English UI — and list rows take `hebrewContentRowDirection()`
 * so the bullet sits on the right.
 */
export function makeLegalMarkdownStyles(colors: ColorPalette) {
  const hebrew = hebrewContentTextStyle();
  return StyleSheet.create({
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
      marginBottom: spacing.sm,
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
    heading4: {
      ...typography.h4,
      color: colors.textPrimary,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      ...hebrew,
    } as TextStyle,
    heading5: {
      ...typography.body,
      color: colors.textPrimary,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      ...hebrew,
    } as TextStyle,
    heading6: {
      ...typography.body,
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
    list: {
      marginBottom: spacing.md,
    } as ViewStyle,
    listItem: {
      flexDirection: hebrewContentRowDirection(),
      gap: spacing.sm,
      alignItems: 'flex-start',
      marginBottom: spacing.sm,
    } as ViewStyle,
    listIcon: {
      ...typography.body,
      color: colors.textSecondary,
      minWidth: 16,
      lineHeight: 26,
      ...hebrew,
    } as TextStyle,
    listContent: {
      ...typography.body,
      color: colors.textPrimary,
      lineHeight: 26,
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
    hr: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: spacing.lg,
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

export type LegalMarkdownStyleMap = ReturnType<typeof makeLegalMarkdownStyles>;
