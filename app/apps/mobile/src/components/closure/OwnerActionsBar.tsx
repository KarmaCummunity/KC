// FR-CLOSURE-001 + FR-CLOSURE-005 — owner CTAs on PostDetail.
//   open (Give)                       → "mark as delivered"
//   open (Request)                    → "mark as received"
//   closed_delivered                  → "reopen"
//   deleted_no_recipient (in grace)   → "reopen"
//   deleted_no_recipient (past grace) → no CTA (post is on its way out)
//   removed_admin / expired           → no CTA
import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, spacing, useTheme } from '@kc/ui';
import type { Post } from '@kc/domain';
import { isPostError, type PostErrorCode } from '@kc/application';
import { useClosureStore } from '../../store/closureStore';
import { getReopenPostUseCase } from '../../services/postsComposition';
import { invalidatePersonalStatsCaches } from '../../lib/invalidatePersonalStatsCaches';
import { invalidateMyProfilePostQueries } from '../../lib/invalidateMyProfilePostQueries';
import { mapPostErrorToHebrew } from '../../services/postMessages';
import { ClosureSheet } from './ClosureSheet';
import { ClosureExplainerSheet } from './ClosureExplainerSheet';
import { ReopenConfirmModal } from './ReopenConfirmModal';
import { hapticSuccess } from '../../lib/haptics';
import { trackSocialHandoverCompleted } from '../../lib/trackSocialHandoverCompleted';
import { PrimaryButton, SecondaryButton } from '../ui/Buttons';

interface Props {
  post: Post;
  ownerId: string;
  /** Extra bottom padding when the global shell tab bar overlays this bar (post detail). */
  tabBarOverlayInset?: number;
  /** Renders inside `PostDetailBottomChrome` — no outer bar chrome or tab inset. */
  embedded?: boolean;
  /** i18n key for the open-offer button. Defaults from post.type. */
  markCtaKey?: string;
  /** Listing offers name the recipient through owner_complete_offer_with_user. */
  offerAssign?: boolean;
  /** When false, step 2 has no "close without marking" (rides, housing). */
  allowCloseWithout?: boolean;
  /** Called after caches are invalidated following a successful close.
   * `assigned` means the offer stayed open (one ride seat or one stay). */
  onClosed: (outcome?: 'closed' | 'assigned') => void | Promise<void>;
  /** Called after a successful reopen. Parent typically shows confirmation and
   * navigates away from post detail (same as onClosed). */
  onReopened: () => void | Promise<void>;
}

export function OwnerActionsBar(props: Readonly<Props>) {
  const styles = useStyles();
  const { colors } = useTheme();
  const {
    post, ownerId, tabBarOverlayInset = 0, embedded = false, onClosed, onReopened,
    markCtaKey, offerAssign = false, allowCloseWithout = true,
  } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const startClosure = useClosureStore((s) => s.start);
  const closureStep = useClosureStore((s) => s.step);
  const closureInitiator = useClosureStore((s) => s.initiator);
  const closureBusy = useClosureStore((s) => s.isBusy);
  const resetClosure = useClosureStore((s) => s.reset);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  const postRef = useRef(post);
  postRef.current = post;

  // When the closure flow finishes, refresh the parent's data. MUST run in
  // useEffect — calling parent setState during render is a React anti-pattern
  // (B2). Reset the store here too so the next closure starts clean.
  // Invalidate post-list caches so the profile grid (open/closed tabs) and
  // header counter reflect the new status without a manual refresh — same
  // keys create.tsx invalidates after publishing a new post.
  // Only handle done-state for closures initiated from the post-detail screen.
  // Chat-initiated closures are handled by AnchoredPostCard's own done-handler.
  useEffect(() => {
    // owner-assign is the same screen's "assign a user" button; it must refresh the passenger list too.
    if (closureStep !== 'done' || (closureInitiator !== 'post-detail' && closureInitiator !== 'owner-assign')) return;
    hapticSuccess();
    trackSocialHandoverCompleted(postRef.current);
    const closedPostId = postRef.current.postId;
    const outcome = useClosureStore.getState().lastOutcome ?? 'closed';
    resetClosure();
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: ['feed'] });
      invalidateMyProfilePostQueries(queryClient, ownerId);
      await queryClient.invalidateQueries({ queryKey: ['post', closedPostId] });
      invalidatePersonalStatsCaches(queryClient, ownerId);
      // The passengers / guests / handoff sections read their own caches, not the post.
      await queryClient.invalidateQueries({ queryKey: ['ride-bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['housing-offer-bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['giving-handoff'] });
      await queryClient.invalidateQueries({ queryKey: ['giving-handoffs'] });
      await queryClient.invalidateQueries({ queryKey: ['marketplace-detail'] });
      await Promise.resolve(onClosed(outcome));
    })();
  }, [closureStep, closureInitiator, resetClosure, onClosed, queryClient, ownerId]);

  const isOpen = post.status === 'open';
  const isReopenable =
    post.status === 'closed_delivered' ||
    (post.status === 'deleted_no_recipient' &&
      post.deleteAfter !== null &&
      new Date(post.deleteAfter).getTime() > Date.now());

  if (!isOpen && !isReopenable) {
    // No CTA — post is in a terminal state.
    return null;
  }

  // Direction flips by post.type — see RecipientCallout for the same convention.
  const markCtaText = t(markCtaKey ?? (post.type === 'Give' ? 'closure.markGiveCta' : 'closure.markRequestCta'));

  async function handleReopen() {
    setIsReopening(true);
    setReopenError(null);
    try {
      await getReopenPostUseCase().execute({ postId: post.postId, ownerId });
      setReopenOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['feed'] });
      invalidateMyProfilePostQueries(queryClient, ownerId);
      await queryClient.invalidateQueries({ queryKey: ['post', post.postId] });
      invalidatePersonalStatsCaches(queryClient, ownerId);
      await Promise.resolve(onReopened());
    } catch (e) {
      const code: PostErrorCode = isPostError(e) ? e.code : 'unknown';
      setReopenError(mapPostErrorToHebrew(code));
    } finally {
      setIsReopening(false);
    }
  }

  return (
    <>
      <View
        style={[
          embedded ? styles.barEmbedded : styles.bar,
          !embedded ? { paddingBottom: spacing.base + tabBarOverlayInset } : null,
        ]}
      >
        {isOpen ? (
          <PrimaryButton
            label={markCtaText}
            size="md"
            fullWidth
            disabled={closureBusy || closureStep !== 'idle'}
            onPress={() => startClosure(post.postId, ownerId, post.type, {
              initiator: 'post-detail',
              offerAssign,
              allowCloseWithout,
              worldSlug: post.listingWorldSlug,
            })}
          />
        ) : (
          <SecondaryButton
            label={t('closure.itemNotDeliveredCta')}
            accessibilityLabel={t('closure.itemNotDeliveredA11y')}
            size="md"
            fullWidth
            disabled={isReopening || reopenOpen}
            onPress={() => {
              setReopenError(null);
              setReopenOpen(true);
            }}
          />
        )}
      </View>

      <ClosureSheet />
      <ClosureExplainerSheet />
      <ReopenConfirmModal
        visible={reopenOpen}
        variant={post.status === 'closed_delivered' ? 'closed_delivered' : 'deleted_no_recipient'}
        postType={post.type}
        isBusy={isReopening}
        errorMessage={reopenError}
        onCancel={() => {
          if (isReopening) return;
          setReopenOpen(false);
          setReopenError(null);
        }}
        onConfirm={() => {
          void handleReopen();
        }}
      />

      {isReopening ? (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  bar: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  barEmbedded: {
    width: '100%',
  },
  busyOverlay: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
}));
