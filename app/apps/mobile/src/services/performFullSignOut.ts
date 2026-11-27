import type { QueryClient } from '@tanstack/react-query';
import type { IDeviceRepository } from '@kc/application';
import { getSignOutUseCase } from './authComposition';
import { clearAllPersistedStores } from '../store/persistedStoresReset';
import { deactivateCurrentDevice } from '../lib/notifications/register';
import { markIntentionalSignOut } from '../lib/observability/reportAuthEvent';
import { finishMark, startMark } from '../lib/observability/perfMarks';

export interface PerformFullSignOutDeps {
  readonly deviceRepo: IDeviceRepository;
  readonly queryClient: QueryClient;
  readonly signOutLocal: () => void;
}

/** Upper bound for the best-effort push deactivation, so a hung push-token lookup cannot stall sign-out. */
const DEVICE_DEACTIVATION_TIMEOUT_MS = 4000;

type SettleOutcome = 'settled' | 'timed_out';

/** Resolves when `work` settles or after `ms`, whichever comes first; never rejects. */
async function settleWithin(work: Promise<unknown>, ms: number): Promise<SettleOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SettleOutcome>((resolve) => {
    timer = setTimeout(() => resolve('timed_out'), ms);
  });
  try {
    return await Promise.race([work.then(settledOutcome, settledOutcome), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const settledOutcome = (): SettleOutcome => 'settled';

/** FR-AUTH-017 — unified teardown: push deactivate, server sign-out, persisted stores, RQ cache. */
export async function performFullSignOut(deps: PerformFullSignOutDeps): Promise<void> {
  // The auth client's SIGNED_OUT event is expected here; it must not be reported as a surprise.
  markIntentionalSignOut(true);
  // #2579: the total and each network phase are timed, so field traces show where logout waits.
  startMark('auth.sign_out');
  try {
    await runFullSignOut(deps);
    finishMark('auth.sign_out', { outcome: 'ok' });
  } catch (err) {
    finishMark('auth.sign_out', { outcome: 'error' });
    throw err;
  } finally {
    markIntentionalSignOut(false);
  }
}

async function runFullSignOut(deps: PerformFullSignOutDeps): Promise<void> {
  // Best-effort and time-boxed — never block local sign-out. `timed_out` means the cap fired.
  startMark('auth.sign_out.device_deactivation');
  const outcome = await settleWithin(
    deactivateCurrentDevice({ deviceRepo: deps.deviceRepo }),
    DEVICE_DEACTIVATION_TIMEOUT_MS,
  );
  finishMark('auth.sign_out.device_deactivation', { outcome });
  await revokeServerSession();
  await clearAllPersistedStores();
  deps.queryClient.clear();
  deps.signOutLocal();
}

/** Server sign-out (with the adapter's local fallback), timed on its own. */
async function revokeServerSession(): Promise<void> {
  startMark('auth.sign_out.server_revoke');
  try {
    await getSignOutUseCase().execute();
    finishMark('auth.sign_out.server_revoke', { outcome: 'ok' });
  } catch (err) {
    finishMark('auth.sign_out.server_revoke', { outcome: 'error' });
    throw err;
  }
}
