// Runs one ride booking action: busy state, success haptic, analytics, cache refresh and a
// friendly alert with the server's error copy on failure (shared by driver and passenger views).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { track } from '../../../lib/analytics';
import { trackCoreLoop } from '../../../lib/analyticsCoreLoop';
import { hapticSuccess } from '../../../lib/haptics';
import { handoffErrorKey } from '../../../lib/marketplaceCreateErrors';
import { rideBookingsQueryKey } from '../../../services/rideBookingComposition';
import { RIDES_FEED_QUERY_KEY } from '../../../services/ridesFeedComposition';

/** Core-loop events a booking action can complete. */
export type RideBookingAnalytics = 'match_made' | 'handover_completed';

export function useRideBookingAction(listingId: string, cityId: string | null) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, analytics?: RideBookingAnalytics) => {
    setBusy(true);
    try {
      await action();
      if (analytics === 'match_made') track('match_made', { world: 'rides' });
      if (analytics === 'handover_completed') trackCoreLoop('handover_completed', { world: 'rides', cityId });
      hapticSuccess();
      // The passenger's own booking, the driver's list, listing detail, feed and handoff lists.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['giving-handoff', listingId] }),
        qc.invalidateQueries({ queryKey: rideBookingsQueryKey(listingId) }),
        qc.invalidateQueries({ queryKey: ['marketplace-detail', listingId] }),
        qc.invalidateQueries({ queryKey: ['marketplace'] }),
        qc.invalidateQueries({ queryKey: ['marketplace-browse'] }),
        qc.invalidateQueries({ queryKey: RIDES_FEED_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: ['giving-handoffs'] }),
      ]);
    } catch (err) {
      alert(t(handoffErrorKey(err) ?? 'givingHandoff.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return { busy, run };
}
