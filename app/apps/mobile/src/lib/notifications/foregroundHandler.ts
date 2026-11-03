import * as Notifications from 'expo-notifications';
import type { PushData } from '@kc/domain';
import { useActiveScreenStore } from './useActiveScreenStore';

let installed = false;

export function installForegroundHandler(): void {
  if (installed) return;
  installed = true;
  Notifications.setNotificationHandler({
    handleNotification: (notification) => {
      const data = notification.request.content.data as Partial<PushData>;
      const activeRoute = useActiveScreenStore.getState().route;
      if (
        data?.kind === 'chat_message' &&
        data.chat_id &&
        activeRoute === `/chat/${data.chat_id}`
      ) {
        return Promise.resolve({
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        });
      }
      return Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      });
    },
  });
}
