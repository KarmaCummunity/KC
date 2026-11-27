// FR-PROFILE-007 + FR-VERIFY-012 — edit-profile state, load, and save. A rejected save marks each
// field it is about under that field (FR-RESP-006 AC29); the messages follow the values until fixed.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AuthSession } from '@kc/application';
import {
  getEditableProfile,
  getSetDateOfBirthUseCase,
  getReconcileDeferredBasicInfoUseCase,
  getUpdateProfileUseCase,
  getUserRepo,
} from '../services/userComposition';
import { useAuthStore } from '../store/authStore';
import { removeUploadedAvatar } from '../services/avatarUpload';
import { mapEditProfileSaveError } from '../lib/editProfileSaveErrors';
import { useProfileFieldErrors } from './useProfileFieldErrors';
import { useAvatarGenerationCleanup } from './useAvatarGenerationCleanup';

export type EditProfileInitialState = {
  readonly displayName: string | null;
  readonly cityId: string | null;
  readonly cityName: string | null;
  readonly profileStreet: string | null;
  readonly profileStreetNumber: string | null;
  readonly contactPhone: string | null;
  readonly biography: string | null;
  readonly avatarUrl: string | null;
  readonly dateOfBirth: string | null;
};

export function useEditProfileController(
  session: AuthSession | null,
  setSession: (s: AuthSession | null) => void,
) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState<{ id: string; name: string } | null>(null);
  const [street, setStreet] = useState('');
  const [streetNumber, setStreetNumber] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [biography, setBiography] = useState('');
  const [avatarUrl, setAvatarUrlState] = useState<string | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [initial, setInitial] = useState<EditProfileInitialState | null>(null);
  const avatarCleanup = useAvatarGenerationCleanup(session?.userId, initial?.avatarUrl);
  /** The form's avatar setter: also tracks unsaved uploads so none outlives the screen. */
  const setAvatarUrl = useCallback((url: string | null) => {
    avatarCleanup.trackPicked(url);
    setAvatarUrlState(url);
  }, [avatarCleanup]);
  const [notify, setNotify] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      try {
        const [p, selfUser] = await Promise.all([
          getEditableProfile(session.userId),
          getUserRepo().findById(session.userId),
        ]);
        if (cancelled) return;
        setDisplayName(p.displayName ?? '');
        setCity(p.city && p.cityName ? { id: p.city, name: p.cityName } : null);
        setStreet(p.profileStreet ?? '');
        setStreetNumber(p.profileStreetNumber ?? '');
        setContactPhone(p.contactPhone ?? '');
        setBiography(p.biography ?? '');
        setAvatarUrlState(p.avatarUrl ?? session.avatarUrl ?? null);
        setDateOfBirth(selfUser?.dateOfBirth ?? null);
        setInitial({
          displayName: p.displayName,
          cityId: p.city,
          cityName: p.cityName,
          profileStreet: p.profileStreet,
          profileStreetNumber: p.profileStreetNumber,
          contactPhone: p.contactPhone,
          biography: p.biography,
          avatarUrl: p.avatarUrl ?? session.avatarUrl ?? null,
          dateOfBirth: selfUser?.dateOfBirth ?? null,
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
      newPhone !== (initial.contactPhone ?? null) ||
      dateOfBirth !== (initial.dateOfBirth ?? null)
    );
  }, [initial, displayName, city, biography, avatarUrl, street, streetNumber, contactPhone, dateOfBirth]);

  const dobChanged = initial !== null && dateOfBirth !== (initial.dateOfBirth ?? null);
  const { fieldErrors, failedSubmitCount, acceptSubmit } = useProfileFieldErrors({
    displayName, cityId: city?.id ?? null, street, streetNumber, contactPhone, dateOfBirth, dateOfBirthChanged: dobChanged,
  });

  const handleSave = useCallback(async () => {
    if (!session || !initial) return;
    // A missing city is one of the field errors; `!city` is repeated so the save below knows the city.
    if (!acceptSubmit() || !city) return;
    const ts = street.trim();
    const tn = streetNumber.trim();
    const tp = contactPhone.trim();
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
      if (!nameChanged && !cityChanged && !bioChanged && !avatarChanged && !addrChanged && !phoneChanged && !dobChanged) {
        router.back();
        return;
      }
      if (dobChanged && dateOfBirth) {
        await getSetDateOfBirthUseCase().execute({
          sessionUserId: session.userId,
          userId: session.userId,
          dateOfBirth,
        });
      }
      const includeBasicInfo = nameChanged || cityChanged;
      const profileAddress = addrChanged ? { street: nextStreet, streetNumber: nextNum } : undefined;
      if (avatarChanged && avatarUrl === null && initial.avatarUrl) await removeUploadedAvatar(session.userId, initial.avatarUrl);
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
      if (avatarChanged) avatarCleanup.committed(avatarUrl);
      await queryClient.invalidateQueries({ queryKey: ['user-profile', session.userId] });
      try {
        const nextOnboarding = await getReconcileDeferredBasicInfoUseCase().execute({
          userId: session.userId,
        });
        if (nextOnboarding) useAuthStore.getState().setOnboardingState(nextOnboarding);
      } catch {
        // Onboarding reconcile is best-effort; profile save already succeeded.
      }
      // The saved values are now the stored ones. Without this, `isDirty` stays true after a
      // successful save, so once `saving` flips back to false the unsaved-changes guard can
      // intercept the back navigation below and show its discard dialog.
      setInitial({
        displayName: trimmedName,
        cityId: city.id,
        cityName: city.name,
        profileStreet: nextStreet,
        profileStreetNumber: nextNum,
        contactPhone: nextPhone,
        biography: newBio,
        avatarUrl,
        dateOfBirth,
      });
      router.back();
    } catch (err) {
      const code = err instanceof Error ? err.message : t('profile.editScreen.unknownError');
      setNotify({ title: t('profile.editScreen.saveFailedTitle'), message: mapEditProfileSaveError(code) });
    } finally {
      setSaving(false);
    }
  }, [
    session, initial, displayName, city, street, streetNumber, contactPhone, biography,
    avatarUrl, dateOfBirth, dobChanged, acceptSubmit, t, router, queryClient, setSession, avatarCleanup,
  ]);

  return {
    loading,
    saving,
    displayName,
    setDisplayName,
    city,
    setCity,
    street,
    setStreet,
    streetNumber,
    setStreetNumber,
    contactPhone,
    setContactPhone,
    biography,
    setBiography,
    avatarUrl,
    setAvatarUrl,
    dateOfBirth,
    setDateOfBirth,
    isDirty,
    fieldErrors,
    failedSubmitCount,
    notify,
    setNotify,
    handleSave,
  };
}
