// Runs one event registration action (register, approve, decline, cancel, remove): busy state,
// success haptic, a refresh of the viewer's registration and the organizer's roster, and the
// server's copy on failure — a known refusal gets its own message, anything else the generic
// listing-action copy and a report (lib/listingActionError).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { hapticSuccess } from '../../../lib/haptics';
import { handoffErrorKey } from '../../../lib/marketplaceCreateErrors';
import { listingActionErrorKey, reportListingActionError } from '../../../lib/listingActionError';
import { eventRosterQueryKey, myEventRegistrationQueryKey } from '../../../services/eventRegistrationComposition';

/** Copy key for a failed event action; unexplained failures are reported under `action`. */
function eventActionErrorKey(action: string, error: unknown): string {
  const known = handoffErrorKey(error);
  if (known) return known;
  reportListingActionError(action, error);
  return listingActionErrorKey(error);
}

export function useEventRegistrationAction(postId: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = async (action: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      hapticSuccess();
      await Promise.all([
        qc.invalidateQueries({ queryKey: myEventRegistrationQueryKey(postId) }),
        qc.invalidateQueries({ queryKey: eventRosterQueryKey(postId) }),
      ]);
    } catch (err) {
      alert(t(eventActionErrorKey(action, err)));
    } finally {
      setBusy(false);
    }
  };

  return { busy, run };
}
