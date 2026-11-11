// Runs one knowledge booking action: busy state, success haptic, analytics, cache refresh and a
// friendly alert with the server's error copy on failure (shared by the giver and learner views).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { track } from '../../../lib/analytics';
import { trackCoreLoop } from '../../../lib/analyticsCoreLoop';
import { hapticSuccess } from '../../../lib/haptics';
import { handoffErrorKey } from '../../../lib/marketplaceCreateErrors';
import { knowledgeBookingsQueryKey, knowledgeSlotsQueryKey } from '../../../services/knowledgeBookingComposition';

/** Core-loop events a booking action can complete. */
export type KnowledgeBookingAnalytics = 'match_made' | 'handover_completed';

export function useKnowledgeBookingAction(listingId: string, cityId: string | null) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, analytics?: KnowledgeBookingAnalytics): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      if (analytics === 'match_made') track('match_made', { world: 'knowledge' });
      if (analytics === 'handover_completed') trackCoreLoop('handover_completed', { world: 'knowledge', cityId });
      hapticSuccess();
      // Both views of this post, its detail, and the lists a booking appears in.
      await Promise.all([
        qc.invalidateQueries({ queryKey: knowledgeSlotsQueryKey(listingId) }),
        qc.invalidateQueries({ queryKey: knowledgeBookingsQueryKey(listingId) }),
        qc.invalidateQueries({ queryKey: ['marketplace-detail', listingId] }),
        qc.invalidateQueries({ queryKey: ['giving-handoffs'] }),
      ]);
      return true;
    } catch (err) {
      alert(t(handoffErrorKey(err) ?? 'givingHandoff.errorGeneric'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, run };
}
