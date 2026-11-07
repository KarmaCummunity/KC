// Registers the center TopBar slot (title string or custom node) and optional
// headerRight on stack screens that use `useShellStackScreenOptions` /
// `topBarStackHeader`. Use from nested sub-screens that replace the logo with
// a menu, live detail title, etc. (world feeds, future settings subtrees).
import { useLayoutEffect, type ReactNode } from 'react';
import { useNavigation } from 'expo-router';
import { stackOptionsForShellTopBarTitle } from './TopBarStackHeader';

export interface ShellTopBarChromePatch {
  /** Plain string or a center slot (world screens menu, dynamic label, …). */
  readonly title?: ReactNode;
  /** Shown before notifications — maps to TopBar `extraIcon` (filter, +, …). */
  readonly headerRight?: ReactNode;
}

/** Pushes title / headerRight into the parent stack via `navigation.setOptions`. */
export function useShellTopBarChrome({ title, headerRight }: ShellTopBarChromePatch): void {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({
      ...stackOptionsForShellTopBarTitle(title),
      ...(headerRight !== undefined ? { headerRight: () => headerRight } : {}),
    });
  }, [navigation, title, headerRight]);
}
