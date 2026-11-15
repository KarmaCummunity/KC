import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NOTIFICATION_CATEGORIES } from '@kc/domain';
import { lightColors } from '@kc/ui';
import i18n from '../../i18n';
import { LEGACY_CHANNEL_ID, NOTIFICATION_CHANNELS } from './channelSpec';

/**
 * Creates what the platform needs before a push can be shown, from the channel spec:
 * Android 8+ notification channels (a push addressed to a channel that does not exist is
 * dropped by the system) and iOS notification categories. Safe to call on every start:
 * creating an existing channel only updates its name.
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS === 'android') {
    for (const category of NOTIFICATION_CATEGORIES) {
      const spec = NOTIFICATION_CHANNELS[category];
      await Notifications.setNotificationChannelAsync(category, {
        name: i18n.t(spec.nameKey),
        description: i18n.t(spec.descriptionKey),
        importance:
          spec.importance === 'high' ? Notifications.AndroidImportance.HIGH : Notifications.AndroidImportance.DEFAULT,
        sound: spec.sound ? 'default' : null,
        vibrationPattern: spec.vibrate ? [0, 250, 250, 250] : null,
        enableVibrate: spec.vibrate,
        // LED colour is OS-level and theme-independent; app.json `notification.color` matches it.
        lightColor: lightColors.primaryVivid,
      });
    }
    await Notifications.deleteNotificationChannelAsync(LEGACY_CHANNEL_ID);
    return;
  }
  if (Platform.OS === 'ios') {
    for (const category of NOTIFICATION_CATEGORIES) {
      await Notifications.setNotificationCategoryAsync(category, []);
    }
  }
}
