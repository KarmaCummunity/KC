import { View } from 'react-native';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';

const useStyles = makeUseStyles(({ colors }) => ({
  track: {
    height: 8,
    borderRadius: radius.xs,
    backgroundColor: colors.border,
    overflow: 'hidden' as const,
    marginTop: spacing.xs,
  },
  fill: { height: '100%' as const, backgroundColor: colors.primary, borderRadius: radius.xs },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
}));

export function CampaignProgressBar({
  raisedIls,
  goalIls,
  label,
}: {
  readonly raisedIls: number;
  readonly goalIls: number;
  readonly label: string;
}) {
  const styles = useStyles();
  const pct = goalIls > 0 ? Math.min(1, raisedIls / goalIls) : 0;
  return (
    <View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}
