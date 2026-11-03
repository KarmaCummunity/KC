// Generic two-button confirmation dialog used by post-detail ⋮ menu actions
// (delete-owner, admin-remove, block). Built on the kit `Modal` (spec 17 §4.1).
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { DangerButton, PrimaryButton, SecondaryButton } from '../ui/Buttons';
import { Modal } from '../ui/Modal';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Secondary action label (defaults to `general.cancel`). */
  cancelLabel?: string;
  /** When true, the confirm action is the red `DangerButton` (D94). */
  destructive?: boolean;
  isBusy?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmActionModal({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel: cancelLabelProp,
  destructive = false,
  isBusy = false,
  errorMessage = null,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const styles = useConfirmActionModalStyles();
  const cancelLabel = cancelLabelProp ?? t('general.cancel');
  const ConfirmButton = destructive ? DangerButton : PrimaryButton;
  return (
    <Modal
      visible={visible}
      title={title}
      onDismiss={onCancel}
      // The request is in flight: keep the dialog until it settles, like the disabled cancel.
      dismissible={!isBusy}
      footer={
        <>
          <ConfirmButton label={confirmLabel} size="md" fullWidth loading={isBusy} onPress={onConfirm} />
          <SecondaryButton label={cancelLabel} size="md" fullWidth disabled={isBusy} onPress={onCancel} />
        </>
      }
    >
      <Text style={styles.message}>{message}</Text>
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
    </Modal>
  );
}

const useConfirmActionModalStyles = makeUseStyles(({ colors }) => ({
  message: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  error: { ...typography.bodySmall, color: colors.error, textAlign: rtlTextAlignStart },
}));
