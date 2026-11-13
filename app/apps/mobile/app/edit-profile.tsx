// FR-PROFILE-007 — Edit Profile (getEditableProfile + UpdateProfileUseCase).
// FR-VERIFY-012 — all fields required for verification level 1 are editable here.
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, Text } from '@kc/ui';
import { TextField, FormScreen, PrimaryButton } from '../src/components/ui';
import { inputTextAlignStart } from '../src/lib/rtlLayout';
import { EditProfileAddressBlock } from '../src/components/EditProfileAddressBlock';
import { EditProfileAvatar } from '../src/components/EditProfileAvatar';
import { NotifyModal } from '../src/components/NotifyModal';
import { useAuthStore } from '../src/store/authStore';
import { EditProfileDateOfBirthBlock } from '../src/components/profile/EditProfileDateOfBirthBlock';
import { EditProfileCompletenessCard } from '../src/components/profile/EditProfileCompletenessCard';
import { useUnsavedChangesGuard } from '../src/hooks/useUnsavedChangesGuard';
import { useEditProfileStyles } from '../src/screens/edit-profile.styles';
import { formPhoneInputProps } from '../src/lib/platform/formTextInputHints';
import { useEditProfileController } from '../src/hooks/useEditProfileController';


export default function EditProfileScreen() {
  const { t } = useTranslation();
  const styles = useEditProfileStyles();
  const { colors } = useTheme();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);

  const form = useEditProfileController(session, setSession);

  useUnsavedChangesGuard({
    isDirty: form.isDirty && !form.saving,
    title: t('profile.editScreen.unsavedChangesTitle'),
    message: t('profile.editScreen.unsavedChangesMessage'),
    discardLabel: t('profile.editScreen.unsavedChangesDiscard'),
    cancelLabel: t('profile.editScreen.unsavedChangesCancel'),
  });

  if (form.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <FormScreen
        edges={['bottom']}
        contentContainerStyle={styles.scroll}
        footer={
          <PrimaryButton
            testID="edit-profile-save"
            label={t('profile.editScreen.save')}
            fullWidth
            loading={form.saving}
            disabled={form.saving}
            onPress={form.handleSave}
          />
        }
      >
        <EditProfileAvatar
          userId={session?.userId ?? ''}
          displayName={form.displayName}
          avatarUrl={form.avatarUrl}
          disabled={form.saving}
          onChange={form.setAvatarUrl}
        />
        <EditProfileCompletenessCard
          displayName={form.displayName}
          cityId={form.city?.id ?? null}
          dateOfBirth={form.dateOfBirth}
          avatarUrl={form.avatarUrl}
          profileStreet={form.street}
          profileStreetNumber={form.streetNumber}
          contactPhone={form.contactPhone}
        />
        <View style={styles.field}>
          <TextField
            label={t('profile.editScreen.fullNameLabel')}
            value={form.displayName}
            onChangeText={form.setDisplayName}
            maxLength={50}
            editable={!form.saving}
            placeholder={t('profile.editScreen.fullNamePlaceholder')}
          />
          <Text style={styles.count}>{form.displayName.length}/50</Text>
        </View>
        <EditProfileDateOfBirthBlock
          value={form.dateOfBirth}
          onChange={form.setDateOfBirth}
          disabled={form.saving}
        />
        <EditProfileAddressBlock
          city={form.city}
          onCityChange={form.setCity}
          street={form.street}
          streetNumber={form.streetNumber}
          onStreetChange={form.setStreet}
          onStreetNumberChange={form.setStreetNumber}
          disabled={form.saving}
        />
        <View style={styles.field}>
          <TextField
            testID="edit-profile-phone"
            label={t('profile.editScreen.contactPhoneLabel')}
            value={form.contactPhone}
            onChangeText={form.setContactPhone}
            maxLength={20}
            {...formPhoneInputProps}
            textAlign={inputTextAlignStart()}
            editable={!form.saving}
            placeholder={t('profile.editScreen.contactPhonePlaceholder')}
          />
          <Text style={styles.helper}>{t('profile.editScreen.contactPhoneHelper')}</Text>
        </View>
        <View style={styles.field}>
          <TextField
            label={t('profile.editScreen.biographyLabel')}
            style={styles.textarea}
            value={form.biography}
            onChangeText={form.setBiography}
            maxLength={200}
            multiline
            editable={!form.saving}
            placeholder={t('profile.editScreen.biographyPlaceholder')}
          />
          <Text style={styles.count}>{form.biography.length}/200</Text>
        </View>
      </FormScreen>
      <NotifyModal
        visible={form.notify !== null}
        title={form.notify?.title ?? ''}
        message={form.notify?.message ?? ''}
        onDismiss={() => form.setNotify(null)}
      />
    </>
  );
}
