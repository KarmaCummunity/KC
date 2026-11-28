// Whether the calling route is the focused screen of its navigator.
//
// A stack keeps the screens under the top one mounted; this lets them pause work nobody sees
// (e.g. the inbox query while a conversation is open, #2571). True on the first render so a
// screen that mounts focused never starts paused.
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      // The effect's cleanup runs when the screen loses focus (another screen pushed on top).
      return () => setFocused(false);
    }, []),
  );
  return focused;
}
