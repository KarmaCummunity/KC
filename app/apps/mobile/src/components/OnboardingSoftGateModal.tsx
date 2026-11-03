// FR-AUTH-015 dialog — display_name + city + optional address, "Save and continue".
// Built on the kit `Modal` (spec 17 §4.1).
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { EditProfileAddressBlock } from './EditProfileAddressBlock';
import { NotifyModal } from './NotifyModal';
import { PrimaryButton } from './ui/Buttons';
import { Modal } from './ui/Modal';
import { TextField } from './ui/TextField';
import { useAuthStore } from '../store/authStore';
import { getCompleteBasicInfoUseCase } from '../services/userComposition';
import { mapEditProfileSaveError } from '../lib/editProfileSaveErrors';
import { getProfileAddressPairIssue } from '../lib/profileAddressFieldGate';
import { useFeedSessionStore } from '../store/feedSessionStore';
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
  const [saving, setSaving] = useState(false);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  const addressIssue = getProfileAddressPairIssue(street, streetNumber);
  const hasRequiredFields = displayName.trim().length > 0 && city !== null;
  const canSubmit = hasRequiredFields && addressIssue === null;

  const showAddressToast = () => {
    if (!addressIssue) return;
    useFeedSessionStore.getState().showEphemeralToast(
      mapEditProfileSaveError(addressIssue),
      'error',
      2800,
    );
  };

  const handleSave = async () => {
    if (!session || !hasRequiredFields || !city) return;
    if (!canSubmit) {
      showAddressToast();
      return;
    }
    setSaving(true);
    try {
      await getCompleteBasicInfoUseCase().execute({
        sessionUserId: session.userId,
        userId: session.userId,
        displayName,
        cityId: city.id,
        cityName: city.name,
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
            // An address issue keeps the button enabled: pressing it explains the issue in a toast.
            disabled={!hasRequiredFields}
            loading={saving}
            onPress={() => void handleSave()}
          />
        }
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
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
            editable={!saving}
          />

          <EditProfileAddressBlock
            city={city}
            onCityChange={setCity}
            street={street}
            streetNumber={streetNumber}
            onStreetChange={setStreet}
            onStreetNumberChange={setStreetNumber}
            disabled={saving}
          />

          <TextField
            label={t('onboarding.contactPhoneLabel')}
            value={contactPhone}
            onChangeText={setContactPhone}
            placeholder={t('onboarding.contactPhonePlaceholder')}
            maxLength={20}
            keyboardType="phone-pad"
            editable={!saving}
          />
        </ScrollView>
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
