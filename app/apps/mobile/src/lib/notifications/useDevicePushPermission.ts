import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export type DevicePushPermission = 'loading' | 'granted' | 'askable' | 'blocked' | 'error';
type Permission = { status: string; canAskAgain?: boolean };

/** An unrequested permission is not a denial. Only an explicit action opens the OS prompt. */
export function devicePushPermission(permission: Permission): DevicePushPermission {
  if (permission.status === 'granted') return 'granted';
  if (permission.status === 'undetermined' || permission.canAskAgain === true) return 'askable';
  return 'blocked';
}

/** Refresh on return from Settings; never register a device for a stale screen/session. */
export function useDevicePushPermission(onGranted: () => Promise<void>, sessionKey: string | null = null) {
  const [status, setStatus] = useState<DevicePushPermission>('loading');
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const locked = useRef(false);
  const generation = useRef(0);
  const granted = useRef(onGranted);
  granted.current = onGranted;

  const refresh = useCallback(async () => {
    const current = generation.current;
    try {
      const register = granted.current;
      const next = devicePushPermission(await Notifications.getPermissionsAsync());
      if (!alive.current || current !== generation.current) return;
      setStatus(next);
      if (next === 'granted') await register();
    } catch {
      if (alive.current && current === generation.current) setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    alive.current = true;
    generation.current += 1;
    setStatus('loading');
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => { alive.current = false; generation.current += 1; subscription.remove(); };
  }, [refresh, sessionKey]);

  const enable = useCallback(async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    const current = generation.current;
    try {
      const permission = await Notifications.getPermissionsAsync();
      if (!alive.current || current !== generation.current) return;
      if (devicePushPermission(permission) === 'blocked') {
        await Linking.openSettings();
        return;
      }
      if (permission.status !== 'granted') await Notifications.requestPermissionsAsync();
      if (current === generation.current) await refresh();
    } catch {
      if (alive.current && current === generation.current) setStatus('error');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }, [refresh]);

  return { status, busy, enable };
}
