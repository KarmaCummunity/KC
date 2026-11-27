// FR-POST-023 AC6 — pending deep-link restoration after sign-in.
//
// When an unauthenticated user lands on `/post/<id>` (or any other deep
// link that AuthGate bounces to `(auth)`), capture the path here BEFORE the
// redirect. After the user completes sign-in (and onboarding), AuthGate
// consumes the captured path and navigates back to where they originally
// wanted to go.
//
// Not persisted — refreshing the app loses the intent, which is fine: a
// browser refresh re-reads the URL bar, and a native cold start usually
// happens long after the share-tap flow finished.

import { create } from 'zustand';

const INTENT_TTL_MS = 10 * 60 * 1000;

// Restorable path prefixes. Auth / onboarding / tabs are intentionally
// excluded so a half-captured intent never bounces the user out of the
// auth flow they just completed. Owner-edit deep links from WhatsApp
// (#2238) must survive sign-in the same way post detail links do.
const RESTORABLE_PATH_PREFIXES = ['/post/', '/edit-post/', '/edit-listing/', '/user/', '/chat/'];

export function isRestorablePath(path: string): boolean {
  if (typeof path !== 'string' || path === '') return false;
  return RESTORABLE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

interface RedirectIntentState {
  pendingPath: string | null;
  capturedAtMs: number | null;
  capturePath: (path: string, nowMs?: number) => void;
  /** Reads + clears the pending path if it is still within the TTL window. */
  consumePath: (nowMs?: number) => string | null;
  clearPath: () => void;
}

export const useRedirectIntentStore = create<RedirectIntentState>((set, get) => ({
  pendingPath: null,
  capturedAtMs: null,
  capturePath: (path, nowMs = Date.now()) => {
    if (!isRestorablePath(path)) return;
    if (get().pendingPath === path) return;
    set({ pendingPath: path, capturedAtMs: nowMs });
  },
  consumePath: (nowMs = Date.now()) => {
    const { pendingPath, capturedAtMs } = get();
    if (pendingPath === null || capturedAtMs === null) return null;
    if (nowMs - capturedAtMs > INTENT_TTL_MS) {
      set({ pendingPath: null, capturedAtMs: null });
      return null;
    }
    set({ pendingPath: null, capturedAtMs: null });
    return pendingPath;
  },
  clearPath: () => set({ pendingPath: null, capturedAtMs: null }),
}));

export const REDIRECT_INTENT_TTL_MS = INTENT_TTL_MS;
