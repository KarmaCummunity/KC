import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, useTheme, Text } from '@kc/ui';
import { rowDirectionStart } from '../lib/rtlLayout';
import { PrimaryButton, SecondaryButton } from './ui/Buttons';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <Ionicons
        name={icon}
        size={56} // brand-guard-allow: empty-state illustration glyph, past the icon scale (spec 17 §4.2)
        color={colors.textDisabled}
        style={styles.icon}
      />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

interface EmptyStateAction {
  label: string;
  onPress: () => void;
  testID?: string;
}

/**
 * The empty state's call to action and an optional secondary one beside it, on the kit buttons
 * (`md`, inside a centred status — spec 17 §8.1 call 5). The kit plays the light haptic.
 */
export function EmptyStateActions({ primary, secondary }: Readonly<{ primary: EmptyStateAction; secondary?: EmptyStateAction }>) {
  const styles = useStyles();
  return (
    <View style={styles.actions}>
      {secondary ? (
        <SecondaryButton label={secondary.label} size="md" testID={secondary.testID} onPress={secondary.onPress} />
      ) : null}
      <PrimaryButton label={primary.label} size="md" testID={primary.testID} onPress={primary.onPress} />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['2xl'],
  },
  icon: {
    marginBottom: spacing.base,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  action: {
    marginTop: spacing.xl,
  },
  actions: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, justifyContent: 'center' as const, gap: spacing.sm },
}));
