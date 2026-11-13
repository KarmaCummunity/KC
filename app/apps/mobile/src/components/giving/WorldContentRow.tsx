// One row of a world's "links and knowledge" lists: a title, an optional second line and,
// when the row leads somewhere, a trailing icon. A row without `onPress` is plain text.
import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  texts: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));

interface Props {
  readonly title: string;
  readonly subtitle?: string | null;
  /** Trailing glyph of a row that opens something (an outside site, another world). */
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly onPress?: () => void;
  readonly testID?: string;
}

export function WorldContentRow({ title, subtitle, icon, onPress, testID }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const body = (
    <>
      <View style={styles.texts}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {onPress && icon ? <Ionicons name={icon} size={iconSize.md} color={colors.textSecondary} /> : null}
    </>
  );
  if (!onPress) {
    return <View style={styles.row} testID={testID}>{body}</View>;
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}
