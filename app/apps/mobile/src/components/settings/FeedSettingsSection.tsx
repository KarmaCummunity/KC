import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';

export function FeedSettingsSection({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  section: { gap: spacing.xs },
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    paddingHorizontal: spacing.xs,
    ...webTextRtl,
  },
  sectionHint: {
    ...typography.caption,
    color: colors.textDisabled,
    textAlign: rtlTextAlignStart,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.xs,
    ...webTextRtl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    overflow: 'hidden' as const,
    ...webViewRtl,
  },
}));
