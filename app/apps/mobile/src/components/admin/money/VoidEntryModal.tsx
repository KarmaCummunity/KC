// FR-FIN-005 AC2 — voiding a ledger entry asks the admin why. The reason (3 to 500
// characters) is kept with the entry; the server refuses a void without one.
import { useEffect, useState } from 'react';
import { isFinanceLedgerError, isValidVoidReason, VOID_REASON_MAX } from '@kc/domain';
import { makeUseStyles, Text, typography } from '@kc/ui';
import { DangerButton, SecondaryButton } from '../../ui/Buttons';
import { Modal } from '../../ui/Modal';
import { TextField } from '../../ui/TextField';
import { rtlTextAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface VoidEntryModalProps {
  /** Open while an entry is being voided. */
  readonly visible: boolean;
  /** Voids the entry with the typed reason; rejects with the server's error. */
  readonly onConfirm: (reason: string) => Promise<void>;
  readonly onClose: () => void;
}

export function VoidEntryModal({ visible, onConfirm, onClose }: VoidEntryModalProps) {
  const styles = useStyles();
  const money = useLocaleBundle().admin.money;
  const copy = money.void;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Each opening starts from an empty reason and no error.
  useEffect(() => {
    if (visible) {
      setReason('');
      setErrorCode(null);
    }
  }, [visible]);

  const submit = async () => {
    if (!isValidVoidReason(reason)) {
      setErrorCode('void_reason_required');
      return;
    }
    setBusy(true);
    setErrorCode(null);
    try {
      await onConfirm(reason);
      onClose();
    } catch (err) {
      setErrorCode(isFinanceLedgerError(err) ? err.code : 'unknown');
    } finally {
      setBusy(false);
    }
  };

  const errors = money.errors;
  const errorText = errorCode === null ? undefined
    : (errors[errorCode as keyof typeof errors] ?? errors.unknown);

  return (
    <Modal
      visible={visible}
      title={copy.title}
      onDismiss={onClose}
      dismissible={!busy}
      footer={
        <>
          <DangerButton testID="admin-money-void-confirm" label={copy.confirm} size="md" fullWidth loading={busy}
            onPress={() => { void submit(); }} />
          <SecondaryButton label={copy.cancel} size="md" fullWidth disabled={busy} onPress={onClose} />
        </>
      }
    >
      <Text style={styles.hint}>{copy.hint}</Text>
      <TextField
        testID="admin-money-void-reason"
        label={copy.reasonLabel}
        placeholder={copy.reasonPlaceholder}
        value={reason}
        onChangeText={setReason}
        maxLength={VOID_REASON_MAX}
        multiline
        errorText={errorText}
      />
    </Modal>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  hint: { ...typography.bodySmall, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
