// 1.5s fullscreen overlay shown after successful self-deletion, before
// the parent navigates to the sign-in screen.

import React from 'react';
import { Modal, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, Text } from '@kc/ui';

export interface DeleteAccountSuccessOverlayProps {
  visible: boolean;
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.textInverse,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textInverse,
    opacity: 0.85,
    textAlign: 'center',
  },
}));

export function DeleteAccountSuccessOverlay({ visible }: DeleteAccountSuccessOverlayProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.root}>
        <Text style={styles.title}>{t('settings.deleteAccountModal.success.title')}</Text>
        <Text style={styles.subtitle}>{t('settings.deleteAccountModal.success.subtitle')}</Text>
      </View>
    </Modal>
  );
}
