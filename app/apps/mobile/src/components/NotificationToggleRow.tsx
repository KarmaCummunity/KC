import { Platform, View } from 'react-native';
import { makeUseStyles, PlatformSwitch, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../lib/webRtlStyle';

interface Props {
  readonly label: string;
  readonly caption: string;
  readonly value: boolean;
  readonly disabled?: boolean;
  readonly onValueChange: (next: boolean) => void;
}

const HAIRLINE = Platform.OS === 'web' ? 1 : 0.5;

export function NotificationToggleRow({
  label,
  caption,
  value,
  disabled,
  onValueChange,
}: Props) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
      <PlatformSwitch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        accent="positive"
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.sm,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: colors.border,
    ...webViewRtl,
  },
  text: { flex: 1, width: '100%' },
  label: {
    ...typography.bodyLarge,
    ...typography.medium,
    textAlign: rtlTextAlignStart,
    color: colors.textPrimary,
    ...webTextRtl,
  },
  caption: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
}));
