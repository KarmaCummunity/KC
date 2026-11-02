// Native-stack options shared by every stack nested under the root stack.
// On iOS the innermost stack must own the interactive swipe-back, otherwise the
// root stack's full-screen gesture pops a root-level screen instead of going
// back exactly one screen. Interactive pop requires the default slide
// animation, so the cross-fade is kept on web only.
import { Platform } from 'react-native';
import { rootStackGestureEnabled, rootStackScreenAnimation } from './rootStackAnimation';

export const nestedStackGestureOptions = {
  animation: rootStackScreenAnimation(),
  animationDuration: Platform.OS === 'web' ? 220 : undefined,
  gestureEnabled: rootStackGestureEnabled,
  fullScreenGestureEnabled: Platform.OS === 'ios',
} as const;
