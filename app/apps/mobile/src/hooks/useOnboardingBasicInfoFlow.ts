// FR-AUTH-010 — basic-info step state + save/skip (keeps screen file under arch line cap). A rejected
// Continue marks each field it is about under that field and jumps to the first (FR-RESP-006 AC29).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useFeedSessionStore } from '../store/feedSessionStore';
import { useOnboardingReplayStore } from '../store/onboardingReplayStore';
import { getCompleteBasicInfoUseCase, markBasicInfoSkipped } from '../services/userComposition';
import { mapEditProfileSaveError } from '../lib/editProfileSaveErrors';
import { measureMark } from '../lib/observability/perfMarks';
import { useAddressStateWithCityReset } from './useAddressStateWithCityReset';
import { useProfileFieldErrors } from './useProfileFieldErrors';

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
  // FR-ADMIN-035: in an admin replay the step validates and moves on but saves nothing.
  const replayActive = useOnboardingReplayStore((s) => s.active);

  // The date of birth is required here (FR-AUTH-010 AC2.d), so it is always checked.
  const { fieldErrors, failedSubmitCount, acceptSubmit } = useProfileFieldErrors({
    displayName, cityId: city?.id ?? null, street, streetNumber, contactPhone, dateOfBirth, dateOfBirthChanged: true,
  });

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
    // City and date are among the field errors; repeated so the save below has them.
    if (!acceptSubmit() || !city || !dateOfBirth) return;
    if (replayActive) {
      router.replace('/(onboarding)/photo');
      return;
    }
    setLoading(true);
    try {
      // #2579: timed, so field traces show how long the save holds the member on this step.
      await measureMark('onboarding.basic_info_save', () =>
        getCompleteBasicInfoUseCase().execute({
          sessionUserId: session.userId,
          userId: session.userId,
          displayName,
          cityId: city.id,
          cityName: city.name,
          dateOfBirth,
          profileStreet: street,
          profileStreetNumber: streetNumber,
          contactPhone,
        }),
      );
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
    if (replayActive) {
      router.replace('/(onboarding)/photo');
      return;
    }
    setLoading(true);
    try {
      await measureMark('onboarding.basic_info_skip', () => markBasicInfoSkipped(session.userId));
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
    fieldErrors,
    failedSubmitCount,
    handleBack,
    handleContinue,
    handleSkip,
  };
}
