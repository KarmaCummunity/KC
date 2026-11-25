// Short inline note shown when the user taps camera or photos after the OS
// will no longer prompt (App Store 5.1.1(iv)). Settings opens only if they
// choose the link — never automatically after "Don't Allow".
import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import type { MediaPermissionKind } from '../lib/mediaPermissionTypes';

interface Props {
  readonly kind: MediaPermissionKind;
}

export function PermissionSettingsNote({ kind }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const message = kind === 'camera'
    ? t('mediaAccess.cameraBlocked')
    : t('mediaAccess.photosBlocked');

  return (
    <View testID="permission-settings-note" style={styles.wrap}>
      <Text style={styles.message}>{message}</Text>
      <Text
        testID="permission-open-settings"
        accessibilityRole="link"
        accessibilityLabel={t('mediaAccess.openSettings')}
        style={styles.link}
        onPress={() => void Linking.openSettings()}
      >
        {t('mediaAccess.openSettings')}
      </Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.xs },
  message: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  link: { ...typography.caption, color: colors.primary, textAlign: rtlTextAlignStart },
}));
