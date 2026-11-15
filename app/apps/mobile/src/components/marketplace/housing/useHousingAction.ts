// Runs one housing booking action: busy state, success haptic, cache refresh and a friendly alert
// with the server's (or the domain's) error copy on failure — shared by the host and guest views.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { hapticSuccess } from '../../../lib/haptics';
import { handoffErrorKey } from '../../../lib/marketplaceCreateErrors';
import { isBackendUnavailable, notAvailableMessage } from '../../../lib/backendAvailability';
import { housingQueryKeys } from '../../../services/housingComposition';

export function useHousingAction(listingId: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  /** Resolves true when the action succeeded, so a caller can close its form. */
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      hapticSuccess();
      await Promise.all([
        qc.invalidateQueries({ queryKey: housingQueryKeys.offerBookings(listingId) }),
        qc.invalidateQueries({ queryKey: housingQueryKeys.myStays }),
        qc.invalidateQueries({ queryKey: housingQueryKeys.privateDetails(listingId) }),
        qc.invalidateQueries({ queryKey: ['marketplace-detail', listingId] }),
      ]);
      return true;
    } catch (err) {
      alert(isBackendUnavailable(err) ? notAvailableMessage() : t(handoffErrorKey(err) ?? 'givingHandoff.errorGeneric'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, run };
}
