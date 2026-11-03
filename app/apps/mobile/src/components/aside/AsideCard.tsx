// Shared section card for desktop aside panels (FR-RESP-003).
// Rendered only inside <AsidePanel> at >=1024px; never on the mobile path.
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

type AsideCardProps = {
  title: string;
  children: ReactNode;
};

export function AsideCard({ title, children }: AsideCardProps) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.base,
  },
  title: {
    ...typography.h4,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: rtlTextAlignStart,
  },
}));
