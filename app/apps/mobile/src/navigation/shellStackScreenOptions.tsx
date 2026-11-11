// Stack options for routes that stay inside the authenticated app shell: the
// shared TopBar (chat, admin portal, notifications, settings) plus native-stack
// transitions. Prefer this over `useDetailStackScreenOptions` on settings, chat
// inbox, notifications, and similar surfaces — not on post/detail flows that
// intentionally use the slimmer native chrome.
//
// Sub-screens that replace the logo with a custom center slot (world screen menu,
// live-loaded title, …) call `useShellTopBarChrome({ title, headerRight })`; admin
// portal routes use `useAdminPortalChrome` instead (TopBar sits above the stack).
import { Platform } from 'react-native';
import { topBarStackHeaderOptions } from './TopBarStackHeader';
import { rootStackGestureEnabled, rootStackScreenAnimation } from './rootStackAnimation';

export function useShellStackScreenOptions() {
  return {
    ...topBarStackHeaderOptions,
    headerBackTitle: '',
    animation: rootStackScreenAnimation(),
    gestureEnabled: rootStackGestureEnabled,
    fullScreenGestureEnabled: Platform.OS === 'ios',
  } as const;
}
