// FR-PROFILE-007 — Edit Profile (getEditableProfile + UpdateProfileUseCase).
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme, Text } from '@kc/ui';
import { TextField } from '../src/components/ui';
import { rtlTextAlignStart } from '../src/lib/rtlLayout';
import { EditProfileAddressBlock } from '../src/components/EditProfileAddressBlock';
import { EditProfileAvatar } from '../src/components/EditProfileAvatar';
import { NotifyModal } from '../src/components/NotifyModal';
import { useAuthStore } from '../src/store/authStore';
import { getEditableProfile, getUpdateProfileUseCase } from '../src/services/userComposition';
import { removeUploadedAvatar } from '../src/services/avatarUpload';
import { mapEditProfileSaveError } from '../src/lib/editProfileSaveErrors';
import { useUnsavedChangesGuard } from '../src/hooks/useUnsavedChangesGuard';
import { useEditProfileStyles } from '../src/screens/edit-profile.styles';

interface InitialState {
  // Nullable after migration 0084 (user still in `pending_basic_info`). The form
  // requires non-null on save; loaders default to '' so inputs stay controlled.
  readonly displayName: string | null;
  readonly cityId: string | null;
  readonly cityName: string | null;
  readonly profileStreet: string | null;
  readonly profileStreetNumber: string | null;
  readonly contactPhone: string | null;
  readonly biography: string | null;
  readonly avatarUrl: string | null;
}

export default function EditProfileScreen() {
  const { t } = useTranslation();
  const styles = useEditProfileStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState<{ id: string; name: string } | null>(null);
  const [street, setStreet] = useState('');
  const [streetNumber, setStreetNumber] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [biography, setBiography] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [initial, setInitial] = useState<InitialState | null>(null);
  // TD-138 — Alert.alert is a no-op on react-native-web; surface every
  // validation / load / save failure via NotifyModal instead.
  const [notify, setNotify] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await getEditableProfile(session.userId);
        if (cancelled) return;
        setDisplayName(p.displayName ?? '');
        setCity(p.city && p.cityName ? { id: p.city, name: p.cityName } : null);
        setStreet(p.profileStreet ?? '');
        setStreetNumber(p.profileStreetNumber ?? '');
        setContactPhone(p.contactPhone ?? '');
        setBiography(p.biography ?? '');
        setAvatarUrl(p.avatarUrl ?? session.avatarUrl ?? null);
        setInitial({
          displayName: p.displayName,
          cityId: p.city,
          cityName: p.cityName,
          profileStreet: p.profileStreet,
          profileStreetNumber: p.profileStreetNumber,
          contactPhone: p.contactPhone,
          biography: p.biography,
          avatarUrl: p.avatarUrl ?? session.avatarUrl ?? null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : t('profile.editScreen.unknownError');
        setNotify({ title: t('profile.editScreen.loadFailedTitle'), message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session, t]);

  // Audit §16.10 — confirm before discarding unsaved edits on Back.
  const isDirty = useMemo(() => {
    if (!initial) return false;
    const ts = street.trim() || null;
    const tn = streetNumber.trim() || null;
    const newBio = biography.trim() || null;
    const newPhone = contactPhone.trim() || null;
    return (
      displayName.trim() !== (initial.displayName ?? '') ||
      (city?.id ?? '') !== (initial.cityId ?? '') ||
      newBio !== initial.biography ||
      avatarUrl !== initial.avatarUrl ||
      ts !== (initial.profileStreet ?? null) ||
      tn !== (initial.profileStreetNumber ?? null) ||
      newPhone !== (initial.contactPhone ?? null)
    );
  }, [initial, displayName, city, biography, avatarUrl, street, streetNumber, contactPhone]);
  useUnsavedChangesGuard({
    isDirty: isDirty && !saving,
    title: t('profile.editScreen.unsavedChangesTitle'), message: t('profile.editScreen.unsavedChangesMessage'),
    discardLabel: t('profile.editScreen.unsavedChangesDiscard'), cancelLabel: t('profile.editScreen.unsavedChangesCancel'),
  });

  const handleSave = async () => {
    if (!session || !initial) return;
    if (displayName.trim().length === 0 || displayName.trim().length > 50) {
      setNotify({ title: t('profile.editScreen.invalidNameTitle'), message: t('profile.editScreen.invalidNameMessage') });
      return;
    }
    if (!city) {
      setNotify({ title: t('profile.editScreen.missingCityTitle'), message: t('profile.editScreen.missingCityMessage') });
      return;
    }
    const ts = street.trim();
    const tn = streetNumber.trim();
    const addrTitle = t('profile.editScreen.incompleteAddressTitle');
    if (ts.length > 0 && tn.length === 0) {
      setNotify({ title: addrTitle, message: t('profile.editScreen.incompleteAddressMessageNumber') });
      return;
    }
    if (tn.length > 0 && ts.length === 0) {
      setNotify({ title: addrTitle, message: t('profile.editScreen.incompleteAddressMessageStreet') });
      return;
    }
    const tp = contactPhone.trim();
    if (tp.length > 20) {
      setNotify({
        title: t('profile.editScreen.invalidContactPhoneTitle'),
        message: t('profile.editScreen.invalidContactPhoneMessage'),
      });
      return;
    }
    setSaving(true);
    try {
      const trimmedName = displayName.trim();
      const trimmedBio = biography.trim();
      const newBio = trimmedBio.length === 0 ? null : trimmedBio;
      const nameChanged = trimmedName !== (initial.displayName ?? '');
      const cityChanged = city.id !== (initial.cityId ?? '');
      const bioChanged = newBio !== initial.biography;
      const avatarChanged = avatarUrl !== initial.avatarUrl;
      const nextStreet = ts.length === 0 ? null : ts;
      const nextNum = tn.length === 0 ? null : tn;
      const addrChanged =
        (nextStreet ?? null) !== (initial.profileStreet ?? null) ||
        (nextNum ?? null) !== (initial.profileStreetNumber ?? null);
      const nextPhone = tp.length === 0 ? null : tp;
      const phoneChanged = (nextPhone ?? null) !== (initial.contactPhone ?? null);
      if (!nameChanged && !cityChanged && !bioChanged && !avatarChanged && !addrChanged && !phoneChanged) {
        router.back();
        return;
      }
      const includeBasicInfo = nameChanged || cityChanged;
      const profileAddress = addrChanged ? { street: nextStreet, streetNumber: nextNum } : undefined;
      // TD-108: drop the Storage object before persisting null on remove.
      if (avatarChanged && avatarUrl === null && initial.avatarUrl) await removeUploadedAvatar(session.userId);
      await getUpdateProfileUseCase().execute({
        sessionUserId: session.userId,
        userId: session.userId,
        ...(includeBasicInfo
          ? { displayName: trimmedName, city: city.id, cityName: city.name }
          : {}),
        ...(profileAddress !== undefined ? { profileAddress } : {}),
        ...(phoneChanged ? { contactPhone: nextPhone } : {}),
        ...(bioChanged ? { biography: newBio } : {}),
        ...(avatarChanged ? { avatarUrl } : {}),
      });
      setSession({ ...session, displayName: trimmedName, avatarUrl });
      await queryClient.invalidateQueries({ queryKey: ['user-profile', session.userId] });
      router.back();
    } catch (err) {
      const code = err instanceof Error ? err.message : t('profile.editScreen.unknownError');
      setNotify({ title: t('profile.editScreen.saveFailedTitle'), message: mapEditProfileSaveError(code) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <EditProfileAvatar userId={session?.userId ?? ''} displayName={displayName}
            avatarUrl={avatarUrl} disabled={saving} onChange={setAvatarUrl} />
          <View style={styles.field}>
            <TextField label={t('profile.editScreen.fullNameLabel')} value={displayName} onChangeText={setDisplayName}
              maxLength={50} textAlign={rtlTextAlignStart} editable={!saving}
              placeholder={t('profile.editScreen.fullNamePlaceholder')} />
            <Text style={styles.count}>{displayName.length}/50</Text>
          </View>
          <EditProfileAddressBlock city={city} onCityChange={setCity} street={street}
            streetNumber={streetNumber} onStreetChange={setStreet}
            onStreetNumberChange={setStreetNumber} disabled={saving} />
          <View style={styles.field}>
            <TextField label={t('profile.editScreen.contactPhoneLabel')} value={contactPhone} onChangeText={setContactPhone}
              maxLength={20} keyboardType="phone-pad" textAlign={rtlTextAlignStart} editable={!saving}
              placeholder={t('profile.editScreen.contactPhonePlaceholder')} />
          </View>
          <View style={styles.field}>
            <TextField label={t('profile.editScreen.biographyLabel')} style={styles.textarea} value={biography} onChangeText={setBiography}
              maxLength={200} multiline textAlign={rtlTextAlignStart} editable={!saving}
              placeholder={t('profile.editScreen.biographyPlaceholder')} />
            <Text style={styles.count}>{biography.length}/200</Text>
          </View>
          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.saveText}>{t('profile.editScreen.save')}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      <NotifyModal visible={notify !== null} title={notify?.title ?? ''}
        message={notify?.message ?? ''} onDismiss={() => setNotify(null)} />
    </SafeAreaView>
  );
}

