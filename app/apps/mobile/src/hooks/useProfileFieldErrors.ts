// Mapped to spec: FR-PROFILE-007 / FR-AUTH-010 / FR-AUTH-015 / FR-RESP-006 AC29 — the field messages
// of a profile form. Nothing is marked before the first rejected save (an empty form is not an error
// yet); from then on each message follows the values and disappears once its field is fixed. Every
// rejected save bumps `failedSubmitCount`, which the form passes to `jumpToProblemSignal`.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isProfileValid, profileFieldErrors, type ProfileFieldErrors, type ProfileFieldValues } from '../lib/profileFieldErrors';

const NO_ERRORS: ProfileFieldErrors = {};

export function useProfileFieldErrors(values: ProfileFieldValues) {
  const { t } = useTranslation();
  const [failedSubmitCount, setFailedSubmitCount] = useState(0);
  const { displayName, cityId, street, streetNumber, contactPhone, dateOfBirth, dateOfBirthChanged } = values;
  const current = useMemo(
    () =>
      profileFieldErrors(
        { displayName, cityId, street, streetNumber, contactPhone, dateOfBirth, dateOfBirthChanged },
        t,
        new Date(),
      ),
    [displayName, cityId, street, streetNumber, contactPhone, dateOfBirth, dateOfBirthChanged, t],
  );
  return {
    fieldErrors: failedSubmitCount > 0 ? current : NO_ERRORS,
    failedSubmitCount,
    /** True when the form may be saved; otherwise marks its fields and re-jumps to the first problem. */
    acceptSubmit: (): boolean => {
      if (isProfileValid(current)) return true;
      setFailedSubmitCount((n) => n + 1);
      return false;
    },
  };
}
