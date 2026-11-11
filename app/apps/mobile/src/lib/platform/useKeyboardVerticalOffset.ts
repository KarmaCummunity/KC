import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import {
  type KeyboardVerticalOffsetOptions,
  resolveKeyboardVerticalOffset,
} from './keyboardVerticalOffset';

/**
 * Cross-platform `keyboardVerticalOffset` for `<KeyboardAvoidingView>` (FR-RESP-006 AC5).
 */
export function useKeyboardVerticalOffset(options: KeyboardVerticalOffsetOptions = {}): number {
  const insets = useSafeAreaInsets();
  const inferredHeader = useHeaderHeight();
  return resolveKeyboardVerticalOffset(Platform.OS, insets.top, inferredHeader, options);
}
