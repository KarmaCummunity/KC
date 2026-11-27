import * as Notifications from 'expo-notifications';

// Expo IosAuthorizationStatus.AUTHORIZED. Keep this module compatible with native mocks.
const IOS_AUTHORIZED = 2;

/** Current OS authorization, not a saved token, controls visible notification effects. */
export async function currentNotificationPresentation() {
  const silent = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') return silent;
    const ios = permission.ios;
    // Provisional/ephemeral access does not prove an explicit opt-in.
    if (ios && ios.status !== IOS_AUTHORIZED) return silent;
    return {
      shouldShowBanner: ios ? ios.allowsAlert === true : true,
      shouldShowList: ios ? ios.allowsDisplayInNotificationCenter === true : true,
      shouldPlaySound: ios ? ios.allowsSound === true : true,
      shouldSetBadge: ios ? ios.allowsBadge === true : true,
    };
  } catch {
    return silent;
  }
}
