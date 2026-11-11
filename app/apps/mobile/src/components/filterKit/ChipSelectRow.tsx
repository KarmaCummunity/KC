// Mapped to spec: FR-POST-001 AC6 / FR-FEED-004 — single-line chip rows in forms and filter sheets
// with sideways scroll and an optional expand control (replaces multi-row wrap by default).
import React, { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, useTheme } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';

export interface ChipSelectRowProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly contentContainerStyle?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
  /** When false, chips stay on one horizontal scroll line with no expand control. */
  readonly expandable?: boolean;
}

export function ChipSelectRow({
  children,
  style,
  contentContainerStyle,
  testID,
  accessibilityLabel,
  expandable = true,
}: ChipSelectRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useChipSelectRowStyles();
  const [expanded, setExpanded] = useState(false);

  const chipGapRow = [styles.gapRow, contentContainerStyle];

  if (!expandable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.scroll, style]}
        contentContainerStyle={chipGapRow}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </ScrollView>
    );
  }

  const toggleExpanded = () => setExpanded((open) => !open);

  if (expanded) {
    return (
      <View style={[styles.block, style]} testID={testID}>
        <View style={[styles.wrapRow, contentContainerStyle]}>{children}</View>
        <Pressable
          style={styles.expandBtn}
          onPress={toggleExpanded}
          accessibilityRole="button"
          accessibilityLabel={t('common.chipRowCollapseA11y')}
          testID={testID ? `${testID}-collapse` : undefined}
        >
          <Ionicons name="chevron-up" size={iconSize.sm} color={colors.textSecondary} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.compactRow, style]} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.scroll, styles.scrollFlex]}
        contentContainerStyle={chipGapRow}
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </ScrollView>
      <Pressable
        style={styles.expandBtn}
        onPress={toggleExpanded}
        accessibilityRole="button"
        accessibilityLabel={t('common.chipRowExpandA11y')}
        testID={testID ? `${testID}-expand` : undefined}
      >
        <Ionicons name="chevron-down" size={iconSize.sm} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const useChipSelectRowStyles = makeUseStyles(({ colors }) => ({
  scroll: { flexGrow: 0, flexShrink: 0 },
  block: { gap: spacing.xs },
  compactRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Longhands, not `flex: 1`: with `scroll` setting flexGrow/flexShrink 0, react-native-web resolves the
  // shorthand + longhand mix to `flex: 0 0 0%` and the chips collapse to zero width (invisible, unclickable).
  scrollFlex: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  gapRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  wrapRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: spacing.sm,
    alignItems: 'center' as const,
  },
  expandBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexShrink: 0,
  },
}));
