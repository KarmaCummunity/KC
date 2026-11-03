import { View } from 'react-native';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';

export interface AdminListEmptyProps {
  readonly title: string;
  readonly hint:  string;
}

export function AdminListEmpty({ title, hint }: AdminListEmptyProps) {
  const styles = useStyles();
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  box:   { padding: spacing['2xl'], alignItems: 'center', gap: spacing.sm },
  title: { fontSize: typography.bodyLarge.fontSize, ...typography.semiBold },
  hint:  { fontSize: typography.bodySmall.fontSize, opacity: 0.6, textAlign: 'center' },
}));
