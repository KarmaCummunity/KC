// FR-AUTH-015 dialog — display_name + city + date of birth + optional address, "Save and continue".
// Built on the kit `Modal` (spec 17 §4.1). Save stays enabled: pressing it explains what is missing under
// each field and jumps to the first (FR-RESP-006 AC29).
import { useState } from 'react';
import { FormScrollView } from './ui/FormScrollView';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { DateOfBirthField } from './DateOfBirthField';
import { EditProfileAddressBlock } from './EditProfileAddressBlock';
import { NotifyModal } from './NotifyModal';
import { PrimaryButton } from './ui/Buttons';
import { Modal } from './ui/Modal';
import { TextField } from './ui/TextField';
import { useAuthStore } from '../store/authStore';
import { getCompleteBasicInfoUseCase } from '../services/userComposition';
import { mapEditProfileSaveError } from '../lib/editProfileSaveErrors';
import { useFeedSessionStore } from '../store/feedSessionStore';
import { useProfileFieldErrors } from '../hooks/useProfileFieldErrors';
import { useTranslation } from 'react-i18next';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function OnboardingSoftGateModal({ visible, onClose, onSaved }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const session = useAuthStore((s) => s.session);
  const setOnboardingState = useAuthStore((s) => s.setOnboardingState);
  const [displayName, setDisplayName] = useState(session?.displayName ?? '');
  const [city, setCity] = useState<{ id: string; name: string } | null>(null);
  const [street, setStreet] = useState('');
  const [streetNumber, setStreetNumber] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  // The date of birth is required here, as in onboarding (FR-AUTH-015 AC1), so it is always checked.
  const { fieldErrors, failedSubmitCount, acceptSubmit } = useProfileFieldErrors({
    displayName, cityId: city?.id ?? null, street, streetNumber, contactPhone, dateOfBirth, dateOfBirthChanged: true,
  });

  const handleSave = async () => {
    if (!session) return;
    // City and date are among the field errors; repeated so the save below has them.
    if (!acceptSubmit() || !city || !dateOfBirth) return;
    setSaving(true);
    try {
      await getCompleteBasicInfoUseCase().execute({
        sessionUserId: session.userId,
        userId: session.userId,
        displayName,
        cityId: city.id,
        cityName: city.name,
        dateOfBirth,
        profileStreet: street,
        profileStreetNumber: streetNumber,
        contactPhone,
      });
      setOnboardingState('pending_avatar');
      onSaved();
    } catch (err) {
      const raw = err instanceof Error ? err.message : t('onboarding.unknownError');
      const mapped = mapEditProfileSaveError(raw);
      useFeedSessionStore.getState().showEphemeralToast(mapped, 'error', 2800);
      setSaveErrorMsg(mapped); // TD-138: Alert.alert no-op on web → NotifyModal.
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        visible={visible}
        title={t('onboarding.softGateTitle')}
        onDismiss={onClose}
        // The ✕ replaces the old "Cancel" link and keeps its screen-reader name.
        closeAccessibilityLabel={t('general.cancel')}
        // Keep the form up while the save is in flight.
        dismissible={!saving}
        footer={
          <PrimaryButton
            label={t('onboarding.saveAndContinue')}
            size="md"
            fullWidth
            loading={saving}
            onPress={() => void handleSave()}
          />
        }
      >
        <FormScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          jumpToProblemSignal={failedSubmitCount}
          // iOS: inset the form above the keyboard so the focused field stays visible.
          automaticallyAdjustKeyboardInsets
        >
          <Text style={styles.subtitle}>{t('onboarding.basicInfoSubtitle')}</Text>

          <TextField
            label={t('onboarding.displayName')}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={t('onboarding.fullNamePlaceholder')}
            maxLength={50}
            inputKind="name"
            editable={!saving}
            errorText={fieldErrors.displayName}
          />

          <DateOfBirthField value={dateOfBirth} onChange={setDateOfBirth} disabled={saving} errorText={fieldErrors.dateOfBirth} />

          <EditProfileAddressBlock
            city={city}
            onCityChange={setCity}
            street={street}
            streetNumber={streetNumber}
            onStreetChange={setStreet}
            onStreetNumberChange={setStreetNumber}
            disabled={saving}
            error={fieldErrors.address}
          />

          <TextField
            label={t('onboarding.contactPhoneLabel')}
            value={contactPhone}
            onChangeText={setContactPhone}
            placeholder={t('onboarding.contactPhonePlaceholder')}
            maxLength={20}
            editable={!saving}
            inputKind="phone"
            errorText={fieldErrors.contactPhone}
          />
        </FormScrollView>
      </Modal>
      <NotifyModal visible={!!saveErrorMsg} title={t('onboarding.saveFailed')} message={saveErrorMsg ?? ''} onDismiss={() => setSaveErrorMsg(null)} />
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  // Shrink inside the dialog's height cap so the save button stays on screen.
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: spacing.base },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
