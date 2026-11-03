// app/apps/mobile/src/components/NotifyModal.tsx
// Single-button informational dialog — cross-platform replacement for
// `Alert.alert(title, message)` on web, where react-native-web@0.21.2 ships
// Alert as a no-op. Built on the kit `Modal` (spec 17 §4.1), like
// ConfirmActionModal, so the two feel like one component family.

import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { PrimaryButton } from './ui/Buttons';
import { Modal } from './ui/Modal';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  ctaLabel?: string;
  onDismiss: () => void;
}

export function NotifyModal({ visible, title, message, ctaLabel, onDismiss }: Props) {
  const { t } = useTranslation();
  const styles = useNotifyModalStyles();
  const label = ctaLabel ?? t('general.gotIt');
  return (
    <Modal
      visible={visible}
      title={title}
      onDismiss={onDismiss}
      footer={<PrimaryButton label={label} size="md" fullWidth onPress={onDismiss} />}
    >
      <Text style={styles.message}>{message}</Text>
    </Modal>
  );
}

const useNotifyModalStyles = makeUseStyles(({ colors }) => ({
  message: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
