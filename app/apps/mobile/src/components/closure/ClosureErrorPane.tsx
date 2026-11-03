// FR-CLOSURE-001 — error pane shown inside ClosureSheet when start() fails
// (e.g. block-list fetch rejected). Without this the modal would never appear
// and the CTA would just stay disabled — the original "nothing happens" bug.
// The error title is the heading of the enclosing kit `BottomSheet` (ClosureSheet).
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { PrimaryButton } from '../ui/Buttons';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface Props {
  readonly errorMessage: string | null;
  readonly onClose: () => void;
}

export function ClosureErrorPane({ errorMessage, onClose }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.pane}>
      <Text style={styles.body}>{errorMessage ?? t('closure.errorDefault')}</Text>
      <PrimaryButton label={t('general.close')} size="md" fullWidth onPress={onClose} />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  pane: { gap: spacing.sm },
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart, marginBottom: spacing.sm },
}));
