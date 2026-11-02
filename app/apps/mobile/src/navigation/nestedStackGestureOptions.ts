// Native-stack options shared by every stack nested under the root stack.
// On iOS the innermost stack must own the interactive swipe-back, otherwise the
// root stack's full-screen gesture pops a root-level screen instead of going
// back exactly one screen. Interactive pop requires the default slide
// animation, so the cross-fade is kept on web only.
import { Platform } from 'react-native';
import { rootStackScreenAnimation } from './rootStackAnimation';

export function getNestedStackGestureOptions() {
  const isWeb = Platform.OS === 'web';
  return {
    animation: rootStackScreenAnimation(),
    animationDuration: isWeb ? 220 : undefined,
    gestureEnabled: !isWeb,
    fullScreenGestureEnabled: Platform.OS === 'ios',
  } as const;
}

export const nestedStackGestureOptions = getNestedStackGestureOptions();
