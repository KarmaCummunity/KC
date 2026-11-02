// KC#1310 — the listing detail's action row, shown per viewer role: the owner can share the
// listing to the feed (unless it is already mirrored there, D-206); anyone else can message the
// owner and report the listing. Everyone can share the link. Server failures surface as an
// alert instead of a silent no-op.
import React, { useState } from 'react';
import { Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';
import { marketplaceRepository } from '../../services/marketplaceComposition';
import { trackCoreLoop } from '../../lib/analyticsCoreLoop';
import { PrimaryButton, SecondaryButton } from '../ui/Buttons';

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

  /** Runs a server action once at a time and tells the viewer when it fails. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      alert(t('marketplace.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const startChat = () =>
    run(async () => {
      const chatId = await marketplaceRepository().startChat(detail.listingId, t('marketplace.chatOpener'));
      trackCoreLoop('chat_started', { world: detail.worldSlug, cityId: detail.cityId });
      router.push(`/chat/${chatId}`);
    });

  const shareToFeed = () =>
    run(async () => {
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
        <PrimaryButton
          testID="listing-action-start-chat"
          label={t('marketplace.startChat')}
          size="md"
          disabled={busy}
          onPress={() => void startChat()}
        />
      ) : null}
      <SecondaryButton
        testID="listing-action-share-link"
        label={t('marketplace.shareLink')}
        size="md"
        onPress={() => void shareLink()}
      />
      {canShareToFeed ? (
        <SecondaryButton
          testID="listing-action-share-feed"
          label={t('marketplace.shareFeed')}
          size="md"
          disabled={busy}
          onPress={() => void shareToFeed()}
        />
      ) : null}
      {!isOwner ? (
        <SecondaryButton testID="listing-action-report" label={t('marketplace.report')} size="md" onPress={onReport} />
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  actions: { gap: spacing.sm },
}));
