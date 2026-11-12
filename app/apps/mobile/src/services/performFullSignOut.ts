import type { QueryClient } from '@tanstack/react-query';
import type { IDeviceRepository } from '@kc/application';
import { getSignOutUseCase } from './authComposition';
import { clearAllPersistedStores } from '../store/persistedStoresReset';
import { deactivateCurrentDevice } from '../lib/notifications/register';

export interface PerformFullSignOutDeps {
  readonly deviceRepo: IDeviceRepository;
  readonly queryClient: QueryClient;
  readonly signOutLocal: () => void;
}

/** Upper bound for the best-effort push deactivation, so a hung push-token lookup cannot stall sign-out. */
const DEVICE_DEACTIVATION_TIMEOUT_MS = 4000;

/** Resolves when `work` settles or after `ms`, whichever comes first; never rejects. */
async function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([work.catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** FR-AUTH-017 — unified teardown: push deactivate, server sign-out, persisted stores, RQ cache. */
export async function performFullSignOut(deps: PerformFullSignOutDeps): Promise<void> {
  // Best-effort and time-boxed — never block local sign-out.
  await settleWithin(
    deactivateCurrentDevice({ deviceRepo: deps.deviceRepo }),
    DEVICE_DEACTIVATION_TIMEOUT_MS,
  );
  await getSignOutUseCase().execute();
  await clearAllPersistedStores();
  deps.queryClient.clear();
  deps.signOutLocal();
}
