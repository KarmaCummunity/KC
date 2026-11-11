// Custom render rules for react-native-markdown-display that keep the Hebrew-only
// legal documents (#1733) RTL and right-aligned in both the Hebrew and English UI.
//
// Background — why this exists:
//
// The library renders paragraph / heading1..6 / list_item / blockquote as
// `<View>` wrappers and strips text-style props (incl. `textAlign`,
// `writingDirection`) from them via its internal `removeTextStyleProps`
// helper. Result: a physical right alignment in `LegalMarkdownStyles.ts` ends up
// applied to a View where it does nothing, the inner `textgroup` Text
// inherits no explicit alignment, and the rendered body falls back to the
// platform's default (LTR on web; auto on native) for mixed Hebrew/Latin
// runs — which is what users saw as incorrectly aligned.
//
// Fix: override those rules so each block is a `<Text>` with
// `hebrewContentTextStyle()` applied directly. Inline spans (strong, em,
// link, text) nest inside cleanly and inherit alignment.
//
// Lists keep their two-column structure (icon + content) but use
// `hebrewContentRowDirection()` so the bullet/number lands on the visual right
// on both native and web, whatever the UI language.

import React from 'react';
import { View, type TextStyle, type ViewStyle } from 'react-native';
import { openExternalUrl } from '../../utils/openExternalUrl';
import type { ASTNode, RenderRules } from 'react-native-markdown-display';
import type { ColorPalette } from '@kc/ui';
import { typography, spacing, radius, Text } from '@kc/ui';
import {
  hebrewContentRightBorder,
  hebrewContentRowDirection,
  hebrewContentTextStyle,
} from '../../lib/hebrewContentDirection';

export function makeLegalMarkdownRules(colors: ColorPalette): RenderRules {
  const hebrew = hebrewContentTextStyle();
  const headingStyle = (fontStyle: TextStyle, marginTop: number): TextStyle => ({
    ...fontStyle,
    color: colors.textPrimary,
    marginTop,
    marginBottom: spacing.sm,
    ...hebrew,
  });

  const renderHeading =
    (fontStyle: TextStyle, marginTop: number) =>
    (node: ASTNode, children: React.ReactNode) => (
      <Text
        key={node.key}
        accessibilityRole="header"
        style={headingStyle(fontStyle, marginTop)}
      >
        {children}
      </Text>
    );

  return {
    paragraph: (node, children) => (
      <Text
        key={node.key}
        style={{
          ...typography.body,
          color: colors.textPrimary,
          lineHeight: 26,
          marginBottom: spacing.md,
          ...hebrew,
        }}
      >
        {children}
      </Text>
    ),

    heading1: renderHeading(typography.h2, spacing.lg),
    heading2: renderHeading(typography.h3, spacing.lg),
    heading3: renderHeading(typography.h4, spacing.md),
    heading4: renderHeading(typography.h4, spacing.md),
    heading5: renderHeading(typography.body, spacing.md),
    heading6: renderHeading(typography.body, spacing.md),

    // Lists: keep the icon+content two-slot structure; the bullet/number sits
    // on the visual right and the row `gap` keeps the spacing on its inner
    // side in both layouts. The content slot is a <Text> so children inherit
    // RTL alignment.
    bullet_list: (node, children) => (
      <View key={node.key} style={{ marginBottom: spacing.md }}>
        {children}
      </View>
    ),
    ordered_list: (node, children) => (
      <View key={node.key} style={{ marginBottom: spacing.md }}>
        {children}
      </View>
    ),
    list_item: (node, children, parent) => {
      const isOrdered = parent[0]?.type === 'ordered_list';
      const bulletChar = isOrdered ? `${(node.index ?? 0) + 1}.` : '•';
      const rowStyle: ViewStyle = {
        flexDirection: hebrewContentRowDirection(),
        gap: spacing.sm,
        alignItems: 'flex-start',
        marginBottom: spacing.sm,
      };
      const iconStyle: TextStyle = {
        ...typography.body,
        color: colors.textSecondary,
        minWidth: 16,
        lineHeight: 26,
        ...hebrew,
      };
      return (
        <View key={node.key} style={rowStyle}>
          <Text style={iconStyle}>{bulletChar}</Text>
          <Text
            style={{
              ...typography.body,
              color: colors.textPrimary,
              lineHeight: 26,
              flex: 1,
              ...hebrew,
            }}
          >
            {children}
          </Text>
        </View>
      );
    },

    blockquote: (node, children) => (
      <View
        key={node.key}
        style={{
          backgroundColor: colors.surfaceRaised,
          ...hebrewContentRightBorder(3, colors.primary),
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          marginVertical: spacing.sm,
          borderRadius: radius.xs,
        }}
      >
        {children}
      </View>
    ),

    link: (node, children) => {
      const href = (node.attributes?.href as string | undefined) ?? '';
      return (
        <Text
          key={node.key}
          accessibilityRole="link"
          onPress={
            href
              ? () => {
                  try {
                    openExternalUrl(href);
                  } catch {
                    /* ignore unsafe schemes */
                  }
                }
              : undefined
          }
          style={{
            color: colors.primary,
            textDecorationLine: 'underline',
            ...hebrew,
          }}
        >
          {children}
        </Text>
      );
    },
  };
}
