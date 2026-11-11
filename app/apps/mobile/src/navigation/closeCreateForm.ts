// The create form opens on top of the screen it was launched from; closing it or publishing
// from it returns to that screen (FR-POST-001 AC9, FR-POST-006 AC4).
import type { Href } from 'expo-router';

/** The router surface closing needs (a subset of expo-router's `Router`). */
export interface CreateFormCloseRouter {
  back: () => void;
  canGoBack: () => boolean;
  dismissTo: (href: Href) => void;
}

/** Where closing lands when there is no screen underneath (deep link / reload). */
export const CREATE_FORM_CLOSE_FALLBACK: Href = '/(tabs)';

export function closeCreateForm(router: CreateFormCloseRouter): void {
  if (router.canGoBack()) router.back();
  else router.dismissTo(CREATE_FORM_CLOSE_FALLBACK);
}
