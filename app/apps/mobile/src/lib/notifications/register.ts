import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { RegisterDeviceUseCase, DeactivateDeviceUseCase } from '@kc/application';
import type { IDeviceRepository } from '@kc/application';
import { ensureNotificationChannels } from './channels';

export async function registerCurrentDeviceIfPermitted(
  userId: string,
  deps: { deviceRepo: IDeviceRepository },
): Promise<void> {
  if (!Device.isDevice) return;
  await ensureNotificationChannels();
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status !== 'granted') return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    console.warn('No EAS projectId configured — push token cannot be registered');
    return;
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const platform = (
    Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web'
  ) as 'ios' | 'android' | 'web';
  await new RegisterDeviceUseCase(deps.deviceRepo).execute({ userId, pushToken: token, platform });
}

export async function deactivateCurrentDevice(
  deps: { deviceRepo: IDeviceRepository },
): Promise<void> {
  if (!Device.isDevice) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await new DeactivateDeviceUseCase(deps.deviceRepo).execute(token);
  } catch {
    // Token unavailable — nothing to deactivate.
  }
}

/**
 * Re-registers when the platform rotates the device's push token while the app runs
 * (FR-NOTIF-015 AC2), so the row in `user_devices` never points at a dead token.
 * Returns the unsubscribe function.
 */
export function watchPushTokenRefresh(
  userId: string,
  deps: { deviceRepo: IDeviceRepository },
): () => void {
  if (!Device.isDevice) return () => undefined;
  const subscription = Notifications.addPushTokenListener(() => {
    registerCurrentDeviceIfPermitted(userId, deps).catch(() => undefined);
  });
  return () => subscription.remove();
}
