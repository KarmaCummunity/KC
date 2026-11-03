// FR-CHAT-016 — confirm before removing a thread from the viewer's inbox only.
// Built on the kit `Modal` (spec 17 §4.1); removing is destructive, so the
// confirm is the red `DangerButton` (D94).
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { DangerButton, SecondaryButton } from './ui/Buttons';
import { Modal } from './ui/Modal';

interface Props {
  readonly visible: boolean;
  readonly loading: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function HideChatConfirmModal({ visible, loading, onCancel, onConfirm }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Modal
      visible={visible}
      title={t('chat.hideFromInboxTitle')}
      onDismiss={onCancel}
      // Keep the dialog while the hide request is in flight.
      dismissible={!loading}
      footer={
        <>
          <DangerButton
            label={t('chat.hideFromInboxConfirm')}
            size="md"
            fullWidth
            loading={loading}
            onPress={onConfirm}
          />
          <SecondaryButton
            label={t('chat.hideFromInboxCancel')}
            size="md"
            fullWidth
            disabled={loading}
            onPress={onCancel}
          />
        </>
      }
    >
      <Text style={styles.body}>{t('chat.hideFromInboxBody')}</Text>
    </Modal>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
