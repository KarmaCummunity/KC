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
      // FR-NOTIF-001 AC2: nothing is shown for the conversation the member is looking at.
      const chatId = data?.entity?.type === 'chat' ? data.entity.id : null;
      if (chatId && activeRoute === `/chat/${chatId}`) {
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
