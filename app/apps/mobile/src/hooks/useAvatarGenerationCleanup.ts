// FR-AUTH-011 / FR-PROFILE-007 — keeps avatar generations from outliving their use on the
// edit-profile screen. Every pick uploads a NEW public object before the profile is saved, so:
//   * picking again (or removing the photo) before saving discards the previous unsaved upload;
//   * leaving the screen without saving discards the unsaved upload;
//   * a successful save retires the generation the profile pointed at before.
// Each deletion re-reads the profile first and is skipped on any doubt (avatarLifecycle.ts).

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getUserRepo } from '../services/userComposition';
import { discardUnsavedAvatar, retirePreviousAvatar, type ReadCurrentAvatarUrl } from '../services/avatarLifecycle';

export function useAvatarGenerationCleanup(userId: string | null | undefined, initialAvatarUrl: string | null | undefined) {
  /** The upload picked on this screen and not saved yet, if any. */
  const unsaved = useRef<string | null>(null);
  const mounted = useRef(true);
  const ids = useRef({ userId, initialAvatarUrl });
  ids.current = { userId, initialAvatarUrl };

  const readCurrent = useCallback<ReadCurrentAvatarUrl>(async () => {
    const id = ids.current.userId;
    if (!id) throw new Error('no_session');
    return (await getUserRepo().findById(id))?.avatarUrl ?? null;
  }, []);

  const discard = useCallback((url: string) => {
    const id = ids.current.userId;
    if (id) void discardUnsavedAvatar({ userId: id, uploadedUrl: url, readCurrentAvatarUrl: readCurrent });
  }, [readCurrent]);

  /** The avatar shown on the form changed (a new upload, or removed). */
  const trackPicked = useCallback((url: string | null) => {
    if (!mounted.current) {
      // A late upload result after the screen closed: nothing will save it.
      if (url && url !== ids.current.initialAvatarUrl) discard(url);
      return;
    }
    const previous = unsaved.current;
    if (previous && previous !== url) discard(previous);
    unsaved.current = url && url !== ids.current.initialAvatarUrl ? url : null;
  }, [discard]);

  /** The save succeeded and the profile now points at `committedUrl`. */
  const committed = useCallback((committedUrl: string | null) => {
    unsaved.current = null;
    const { userId: id, initialAvatarUrl: previous } = ids.current;
    if (!id || !committedUrl || committedUrl === previous) return;
    void retirePreviousAvatar({ userId: id, previousUrl: previous, committedUrl, readCurrentAvatarUrl: readCurrent });
  }, [readCurrent]);

  // Leaving without saving: the unsaved upload is never referenced.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (unsaved.current) discard(unsaved.current);
      unsaved.current = null;
    };
  }, [discard]);

  return useMemo(() => ({ trackPicked, committed }), [trackPicked, committed]);
}
