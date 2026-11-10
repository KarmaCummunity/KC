// FR-AUTH-015 AC1.b — asks only for the date of birth: shown before the first meaningful action
// to a member who finished onboarding without one (older accounts, or a skipped first run).
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { dateOfBirthIssue } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { DateOfBirthField } from './DateOfBirthField';
import { NotifyModal } from './NotifyModal';
import { PrimaryButton } from './ui/Buttons';
import { Modal } from './ui/Modal';
import { useAuthStore } from '../store/authStore';
import { getSetDateOfBirthUseCase } from '../services/userComposition';
import { mapEditProfileSaveError } from '../lib/editProfileSaveErrors';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Called after the date is stored, so the deferred action can run. */
  readonly onSaved: () => void;
}

export function DateOfBirthGateModal({ visible, onClose, onSaved }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const session = useAuthStore((s) => s.session);
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const valid = dateOfBirth !== null && dateOfBirthIssue(dateOfBirth, new Date()) === null;

  const handleSave = async () => {
    if (!session || !dateOfBirth || !valid) return;
    setSaving(true);
    try {
      await getSetDateOfBirthUseCase().execute({
        sessionUserId: session.userId,
        userId: session.userId,
        dateOfBirth,
      });
      onSaved();
    } catch (err) {
      setErrorMsg(mapEditProfileSaveError(err instanceof Error ? err.message : t('onboarding.unknownError')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        visible={visible}
        title={t('dateOfBirth.gate.title')}
        onDismiss={onClose}
        closeAccessibilityLabel={t('general.cancel')}
        dismissible={!saving}
        footer={
          <PrimaryButton
            label={t('dateOfBirth.gate.save')}
            size="md"
            fullWidth
            disabled={!valid}
            loading={saving}
            onPress={() => void handleSave()}
          />
        }
      >
        <View style={styles.content}>
          <Text style={styles.subtitle}>{t('dateOfBirth.gate.subtitle')}</Text>
          <DateOfBirthField value={dateOfBirth} onChange={setDateOfBirth} disabled={saving} />
        </View>
      </Modal>
      <NotifyModal
        visible={errorMsg !== null}
        title={t('onboarding.saveFailed')}
        message={errorMsg ?? ''}
        onDismiss={() => setErrorMsg(null)}
      />
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  content: { gap: spacing.base, padding: spacing.base },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
