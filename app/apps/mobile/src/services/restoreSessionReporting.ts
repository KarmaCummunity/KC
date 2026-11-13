// FR-AUTH-013 — cold-start session restore that reports why a persisted session was dropped.
// The restore use case discards a session for an expired token or a denied account gate and
// tolerates a failing gate check; each of those used to leave no trace in Sentry.
import type { AuthSession } from '@kc/application';
import { reportAuthEvent } from '../lib/observability/reportAuthEvent';
import { getRestoreSessionUseCase } from './authComposition';

/** Restores the persisted session and reports every non-happy outcome. Rethrows a restore failure. */
export async function restoreSessionReporting(): Promise<AuthSession | null> {
  try {
    const out = await getRestoreSessionUseCase().execute();
    if (out.endedBy === 'session_expired') reportAuthEvent('restore_session_expired');
    if (out.endedBy === 'account_gate_denied') {
      reportAuthEvent('restore_gate_denied', { account_status: out.gateReason });
    }
    if (out.gateCheckFailed) reportAuthEvent('gate_check_failed', { phase: 'cold_start' });
    if (out.gateCheckTimedOut) reportAuthEvent('gate_check_failed', { phase: 'cold_start_timeout' });
    return out.session;
  } catch (err) {
    reportAuthEvent('restore_failed', {}, err);
    throw err;
  }
}
