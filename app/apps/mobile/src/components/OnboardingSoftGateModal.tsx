// FR-AUTH-015 dialog — display_name + city + date of birth + optional address, "Save and continue".
// Built on the kit `Modal` (spec 17 §4.1).
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useFormFieldFocus } from '../hooks/useFormFieldFocus';
import { formPhoneInputProps } from '../lib/platform/formTextInputHints';
import { KeyboardFormAccessory } from './ui/KeyboardFormAccessory';
import { dateOfBirthIssue } from '@kc/domain';
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
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
  const fieldFocus = useFormFieldFocus(3);
  const nameField = fieldFocus.bindField(0);
  const streetNumberField = fieldFocus.bindField(1);
  const phoneField = fieldFocus.bindField(2);

  const addressIssue = getProfileAddressPairIssue(street, streetNumber);
  const hasRequiredFields =
    displayName.trim().length > 0 && city !== null && dateOfBirth !== null && dateOfBirthIssue(dateOfBirth, new Date()) === null;
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
    if (!session || !hasRequiredFields || !city || !dateOfBirth) return;
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
      {visible ? (
        <KeyboardFormAccessory
          canGoPrev={fieldFocus.canGoPrev}
          canGoNext={fieldFocus.canGoNext}
          onPrev={fieldFocus.focusPrev}
          onNext={fieldFocus.focusNext}
          onDone={fieldFocus.dismiss}
        />
      ) : null}
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
            ref={nameField.ref}
            label={t('onboarding.displayName')}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={t('onboarding.fullNamePlaceholder')}
            maxLength={50}
            editable={!saving}
            onFocus={nameField.onFocus}
            inputAccessoryViewID={nameField.inputAccessoryViewID}
            returnKeyType={nameField.returnKeyType}
            blurOnSubmit={nameField.blurOnSubmit}
            onSubmitEditing={nameField.onSubmitEditing}
          />

          <DateOfBirthField value={dateOfBirth} onChange={setDateOfBirth} disabled={saving} />

          <EditProfileAddressBlock
            city={city}
            onCityChange={setCity}
            street={street}
            streetNumber={streetNumber}
            onStreetChange={setStreet}
            onStreetNumberChange={setStreetNumber}
            disabled={saving}
            streetNumberRef={streetNumberField.ref}
            streetNumberInputProps={{
              onFocus: streetNumberField.onFocus,
              inputAccessoryViewID: streetNumberField.inputAccessoryViewID,
              returnKeyType: streetNumberField.returnKeyType,
              blurOnSubmit: streetNumberField.blurOnSubmit,
              onSubmitEditing: streetNumberField.onSubmitEditing,
            }}
          />

          <TextField
            ref={phoneField.ref}
            label={t('onboarding.contactPhoneLabel')}
            value={contactPhone}
            onChangeText={setContactPhone}
            placeholder={t('onboarding.contactPhonePlaceholder')}
            maxLength={20}
            editable={!saving}
            {...formPhoneInputProps}
            onFocus={phoneField.onFocus}
            inputAccessoryViewID={phoneField.inputAccessoryViewID}
            returnKeyType={phoneField.returnKeyType}
            blurOnSubmit={phoneField.blurOnSubmit}
            onSubmitEditing={phoneField.onSubmitEditing}
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
