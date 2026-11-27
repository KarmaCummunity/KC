import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { RegisterDeviceUseCase, DeactivateDeviceUseCase } from '@kc/application';
import type { IDeviceRepository } from '@kc/application';
import { ensureNotificationChannels } from './channels';

/** Simulator transport is opt-in in dedicated DEV test binaries, never in store builds. */
export function canUseDevicePush(): boolean {
  return Device.isDevice || Constants.expoConfig?.extra?.pushSimulatorEnabled === true;
}

interface RegistrationState {
  pending: Map<string, Promise<void>>;
  savedExpoToken: Map<string, string>;
  savedNativeToken: Set<string>;
  writes: Set<Promise<void>>;
  lastToken?: string;
}
// In-memory only, scoped to the repository/session. Never log or persist token keys.
const registrations = new WeakMap<IDeviceRepository, RegistrationState>();
function stateFor(repo: IDeviceRepository): RegistrationState {
  let state = registrations.get(repo);
  if (!state) {
    state = { pending: new Map(), savedExpoToken: new Map(), savedNativeToken: new Set(), writes: new Set() };
    registrations.set(repo, state);
  }
  return state;
}

interface RegistrationDeps { deviceRepo: IDeviceRepository; isCurrent?: () => boolean }
function isCurrent(deps: RegistrationDeps, state: RegistrationState): boolean {
  return registrations.get(deps.deviceRepo) === state && deps.isCurrent?.() !== false;
}

/** Drop a previously saved token so the server stops pushing after permission is withdrawn. */
async function deactivateSavedToken(deps: RegistrationDeps, state: RegistrationState): Promise<void> {
  const token = state.lastToken;
  if (!token) return;
  try {
    await new DeactivateDeviceUseCase(deps.deviceRepo).execute(token);
    if (isCurrent(deps, state) || registrations.get(deps.deviceRepo) === state) {
      state.lastToken = undefined;
      state.savedExpoToken.clear();
    }
  } catch {
    // Best effort: a later explicit registration or sign-out retries.
  }
}

export function registerCurrentDeviceIfPermitted(
  userId: string,
  deps: RegistrationDeps,
  nativeToken?: Notifications.DevicePushToken,
): Promise<void> {
  if (deps.isCurrent?.() === false) return Promise.resolve();
  const state = stateFor(deps.deviceRepo);
  const requestKey = JSON.stringify([userId, nativeToken ?? null]);
  if (nativeToken && state.savedNativeToken.has(requestKey)) return Promise.resolve();
  const existing = state.pending.get(requestKey);
  if (existing) return existing.then(() => {
    // A replacement effect may join a conversion owned by an unsubscribed effect.
    // If that owner correctly cancelled before persisting, retry for the live caller.
    const saved = nativeToken ? state.savedNativeToken.has(requestKey) : state.savedExpoToken.has(userId);
    if (!saved && isCurrent(deps, state)) return registerCurrentDeviceIfPermitted(userId, deps, nativeToken);
  });
  const pending = register(userId, deps, state, nativeToken).then((success) => {
    // Only successful persistence marks a native token handled. A denied permission,
    // missing project or failed request must remain eligible for a later explicit retry.
    if (nativeToken && success && isCurrent(deps, state)) state.savedNativeToken.add(requestKey);
  }).finally(() => { state.pending.delete(requestKey); });
  state.pending.set(requestKey, pending);
  return pending;
}

async function register(
  userId: string,
  deps: RegistrationDeps,
  state: RegistrationState,
  nativeToken?: Notifications.DevicePushToken,
): Promise<boolean> {
  if (!canUseDevicePush() || !isCurrent(deps, state)) return false;
  await ensureNotificationChannels();
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status !== 'granted') {
    await deactivateSavedToken(deps, state);
    return false;
  }
  if (!isCurrent(deps, state)) return false;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    console.warn('No EAS projectId configured — push token cannot be registered');
    return false;
  }
  // A refresh callback ALREADY has the native token. Calling the native token getter
  // again emits another token event on iOS and creates an unbounded registration loop.
  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId, ...(nativeToken ? { devicePushToken: nativeToken } : {}),
  });
  if (!isCurrent(deps, state)) return false;
  const platform = (
    Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web'
  ) as 'ios' | 'android' | 'web';
  const tokenKey = JSON.stringify([token, platform]);
  if (state.savedExpoToken.get(userId) === tokenKey) return true;
  // Initial acquisition and its token event can resolve concurrently. Coalesce their
  // backend write separately from the conversion request, and don't cache a failure.
  const saveKey = JSON.stringify(['save', userId, tokenKey]);
  let save = state.pending.get(saveKey);
  if (!save) {
    save = new RegisterDeviceUseCase(deps.deviceRepo).execute({ userId, pushToken: token, platform })
      .then(() => { state.savedExpoToken.set(userId, tokenKey); state.lastToken = token; })
      .finally(() => { state.pending.delete(saveKey); state.writes.delete(save!); });
    state.writes.add(save);
    state.pending.set(saveKey, save);
  }
  await save;
  return isCurrent(deps, state);
}

export async function deactivateCurrentDevice(
  deps: RegistrationDeps,
): Promise<void> {
  const previous = registrations.get(deps.deviceRepo);
  // Invalidate old watchers and token conversions BEFORE asking the SDK for a token.
  // That lookup can itself emit a native-token event while logout is still mounted.
  registrations.delete(deps.deviceRepo);
  if (!canUseDevicePush()) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return;
  try {
    // A write already sent cannot be recalled. Order deletion after those writes, but
    // never delete a newer user's registration if logout's best-effort work runs late.
    await Promise.allSettled([...(previous?.writes ?? [])]);
    if (registrations.has(deps.deviceRepo)) return;
    let token = previous?.lastToken;
    if (!token) {
      // Never fetch a push token unless permission is already granted — the SDK
      // must not present the system prompt here (guideline 4.5.4).
      const perm = await Notifications.getPermissionsAsync();
      if (perm.status !== 'granted') return;
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    }
    if (registrations.has(deps.deviceRepo) || deps.isCurrent?.() === false) return;
    await new DeactivateDeviceUseCase(deps.deviceRepo).execute(token);
  } catch {
    // Token unavailable — nothing to deactivate. Sign-out is separately time-boxed.
  }
}

/**
 * Re-registers when the platform rotates the device's push token while the app runs
 * (FR-NOTIF-015 AC2), so the row in `user_devices` never points at a dead token.
 * Returns the unsubscribe function.
 */
export function watchPushTokenRefresh(
  userId: string,
  deps: RegistrationDeps,
): () => void {
  if (!canUseDevicePush()) return () => undefined;
  const state = stateFor(deps.deviceRepo);
  let active = true;
  const watchedDeps = { ...deps, isCurrent: () => active && isCurrent(deps, state) };
  const subscription = Notifications.addPushTokenListener((nativeToken) => {
    if (!watchedDeps.isCurrent()) return;
    registerCurrentDeviceIfPermitted(userId, watchedDeps, nativeToken).catch(() => undefined);
  });
  return () => { active = false; subscription.remove(); };
}
