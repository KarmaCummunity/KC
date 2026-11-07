// FR-AUTH-010 — basic-info step state + save/skip (keeps screen file under arch line cap).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { dateOfBirthIssue } from '@kc/domain';
import { useAuthStore } from '../store/authStore';
import { useFeedSessionStore } from '../store/feedSessionStore';
import { getCompleteBasicInfoUseCase, markBasicInfoSkipped } from '../services/userComposition';
import { mapEditProfileSaveError } from '../lib/editProfileSaveErrors';
import { getProfileAddressPairIssue } from '../lib/profileAddressFieldGate';
import { useAddressStateWithCityReset } from './useAddressStateWithCityReset';

export function useOnboardingBasicInfoFlow() {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const setOnboardingState = useAuthStore((s) => s.setOnboardingState);
  const [displayName, setDisplayName] = useState(session?.displayName ?? '');
  const {
    city, street, streetNumber, setCity, setStreet, setStreetNumber,
  } = useAddressStateWithCityReset({});
  const [contactPhone, setContactPhone] = useState('');
  /** ISO `YYYY-MM-DD`, or null until the three parts form a real date (FR-AUTH-010 AC2.d). */
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const handleBack = () => {
    if (loading) return;
    router.replace('/(onboarding)/about-intro');
  };

  const handleContinue = async () => {
    if (!session) {
      useFeedSessionStore.getState().showEphemeralToast(
        t('onboarding.noActiveSession'),
        'error',
        2500,
      );
      return;
    }
    if (!hasRequiredFields || !city || !dateOfBirth) {
      useFeedSessionStore.getState().showEphemeralToast(t('onboarding.fillNameAndCity'), 'error', 2500);
      return;
    }
    if (!canSubmit) {
      showAddressToast();
      return;
    }
    setLoading(true);
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
      router.replace('/(onboarding)/photo');
    } catch (err) {
      const raw = err instanceof Error ? err.message : t('general.unknownError');
      const mapped = mapEditProfileSaveError(raw);
      useFeedSessionStore.getState().showEphemeralToast(mapped, 'error', 2800);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    if (!session) return;
    setLoading(true);
    try {
      await markBasicInfoSkipped(session.userId);
      useAuthStore.getState().setBasicInfoSkipped(true);
      router.replace('/(onboarding)/photo');
    } catch (err) {
      const raw = err instanceof Error ? err.message : t('general.unknownError');
      const mapped = mapEditProfileSaveError(raw);
      useFeedSessionStore.getState().showEphemeralToast(mapped, 'error', 2800);
    } finally {
      setLoading(false);
    }
  };

  return {
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
    dateOfBirth,
    setDateOfBirth,
    loading,
    hasRequiredFields,
    canSubmit,
    handleBack,
    handleContinue,
    handleSkip,
  };
}
