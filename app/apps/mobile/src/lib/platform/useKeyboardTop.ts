// Mapped to spec: FR-RESP-006 AC25 — where the software keyboard starts on screen, so a form can keep
// the field being typed in above it. Read through a ref: it changes with every keyboard frame and
// must not re-render the form.
import { useEffect, useRef } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

/** The keyboard's top edge in screen coordinates while it is open; null while it is closed. */
export function useKeyboardTop(): React.RefObject<number | null> {
  const top = useRef<number | null>(null);
  useEffect(() => {
    // iOS announces the final frame before the animation; Android only after the keyboard is up.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e: KeyboardEvent) => {
      top.current = e.endCoordinates.screenY;
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      top.current = null;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return top;
}
