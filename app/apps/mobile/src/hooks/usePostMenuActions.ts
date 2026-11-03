// Action handlers + busy/error state for PostMenuSheet.
// Extracted to keep PostMenuSheet under the 200-LOC cap and to make
// the state machine testable in isolation if/when we add tests.
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PostWithOwner } from '@kc/application';
import { isPostError } from '@kc/application';
import { container } from '../lib/container';
import { useFeedSessionStore } from '../store/feedSessionStore';
import { mapPostErrorToHebrew } from '../services/postMessages';

interface Args {
  post: PostWithOwner;
  /** Called after a successful destructive action. */
  onAfterRemoval: () => void;
  /**
   * Called only after a successful action so the parent can close the active
   * modal. On failure the modal stays open so the error can render —
   * `error` propagates instead.
   */
  onSettle: () => void;
}

interface PostMenuActions {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  handleOwnerDelete: () => Promise<void>;
  handleAdminRemove: () => Promise<void>;
}

export function usePostMenuActions({ post, onAfterRemoval, onSettle }: Args): PostMenuActions {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      work: () => Promise<void>,
      opts: { errorCopy: string; successToast: string },
    ) => {
      setBusy(true);
      setError(null);
      const toast = useFeedSessionStore.getState().showEphemeralToast;
      try {
        await work();
        toast(opts.successToast, 'success');
        onSettle();
        onAfterRemoval();
      } catch (e) {
        const modalMsg = isPostError(e) ? mapPostErrorToHebrew(e.code) : opts.errorCopy;
        toast(modalMsg, 'error', 2800);
        setError(modalMsg);
      } finally {
        setBusy(false);
      }
    },
    [onAfterRemoval, onSettle],
  );

  const handleOwnerDelete = useCallback(
    () =>
      run(
        () =>
          container.deletePost.execute({
            postId: post.postId,
            ownerId: post.ownerId,
          }),
        {
        errorCopy: t('post.deleteError'),
        successToast: t('post.deleteSuccess'),
      }),
    [run, post.postId, post.ownerId, t],
  );

  const handleAdminRemove = useCallback(
    () =>
      run(() => container.adminRemovePost.execute({ postId: post.postId }), {
        errorCopy: t('post.adminRemoveError'),
        successToast: t('post.adminRemoveSuccess'),
      }),
    [run, post.postId, t],
  );

  const clearError = useCallback(() => setError(null), []);

  return { busy, error, clearError, handleOwnerDelete, handleAdminRemove };
}
