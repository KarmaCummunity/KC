// KC#1310 — the listing detail's action row, shown per viewer role: the owner can share the
// listing to the feed (unless it is already mirrored there, D-206); anyone else can message the
// owner and report the listing. Everyone can share the link. Server failures surface as an
// alert instead of a silent no-op: a known refusal gets its own copy, anything else the generic
// copy and a report (#1412).
import React, { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';
import { marketplaceRepository } from '../../services/marketplaceComposition';
import { trackCoreLoop } from '../../lib/analyticsCoreLoop';
import { listingActionErrorKey, reportListingActionError } from '../../lib/listingActionError';

interface Props {
  readonly detail: MarketplaceListingDetail;
  /** Signed-in viewer; null for a guest, who sees the viewer actions like any non-owner. */
  readonly viewerId: string | null;
  readonly onReport: () => void;
}

export function ListingDetailActions({ detail, viewerId, onReport }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const isOwner = viewerId !== null && viewerId === detail.ownerId;
  // Items and food listings are mirrored into the feed on publish; the manual share is for
  // listings that are not in the feed yet.
  const canShareToFeed = isOwner && detail.feedPostId === null;

  /** Runs a server action once at a time and tells the viewer why it failed. */
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      reportListingActionError(name, error);
      alert(t(listingActionErrorKey(error)));
    } finally {
      setBusy(false);
    }
  };

  const startChat = () =>
    run('start_chat', async () => {
      const chatId = await marketplaceRepository().startChat(detail.listingId, t('marketplace.chatOpener'));
      trackCoreLoop('chat_started', { world: detail.worldSlug, cityId: detail.cityId });
      router.push(`/chat/${chatId}`);
    });

  const shareToFeed = () =>
    run('share_to_feed', async () => {
      const postId = await marketplaceRepository().shareToFeed(detail.listingId);
      router.push(`/post/${postId}`);
    });

  const shareLink = async () => {
    const url = `${process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'https://karma-community-kc.com'}/donations/marketplace/${detail.listingId}`;
    await Share.share({ message: `${detail.title}\n${url}`, title: detail.title });
  };

  return (
    <View style={styles.actions}>
      {!isOwner ? (
        <Pressable
          testID="listing-action-start-chat"
          style={[styles.btn, styles.btnPrimary]}
          disabled={busy}
          onPress={() => void startChat()}
          accessibilityRole="button"
        >
          <Text style={[styles.btnText, styles.btnTextInverse]}>{t('marketplace.startChat')}</Text>
        </Pressable>
      ) : null}
      <Pressable testID="listing-action-share-link" style={styles.btn} onPress={() => void shareLink()} accessibilityRole="button">
        <Text style={styles.btnText}>{t('marketplace.shareLink')}</Text>
      </Pressable>
      {canShareToFeed ? (
        <Pressable
          testID="listing-action-share-feed"
          style={styles.btn}
          disabled={busy}
          onPress={() => void shareToFeed()}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>{t('marketplace.shareFeed')}</Text>
        </Pressable>
      ) : null}
      {!isOwner ? (
        <Pressable testID="listing-action-report" style={styles.btn} onPress={onReport} accessibilityRole="button">
          <Text style={styles.btnText}>{t('marketplace.report')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  actions: { gap: spacing.sm },
  btn: {
    padding: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnText: { ...typography.body, color: colors.textPrimary, textAlign: 'center' as const },
  btnTextInverse: { color: colors.textInverse },
}));
