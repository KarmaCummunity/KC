// KC#1310 — the listing detail's action row, shown per viewer role: anyone but the owner can
// message the owner, report the listing or block its owner (FR-MOD-003 AC1). Everyone can share
// the listing's link (a listing is a post, so it is already in the feed). Server failures surface as an
// alert instead of a silent no-op: a known refusal gets its own copy, anything else the generic
// copy and a report (#1412).
//
// One primary per screen (spec 17 §8.1 call 6): "message the owner" is the primary only when the
// viewer has no flow action (reserve, claim, book) above this row; beside one it is secondary.
import React, { useState } from 'react';
import { Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';
import { marketplaceRepository } from '../../services/marketplaceComposition';
import { trackCoreLoop } from '../../lib/analyticsCoreLoop';
import { listingActionErrorKey, reportListingActionError } from '../../lib/listingActionError';
import { buildListingShareUrl } from '../../lib/buildListingShareUrl';
import { resolveWebBaseUrl } from '../../lib/buildPostShareUrl';
import { PrimaryButton, SecondaryButton } from '../ui/Buttons';
import { listingFlowHasViewerAction } from './listingFlow';
import { useUserBlock } from '../../hooks/useUserBlock';

interface Props {
  readonly detail: MarketplaceListingDetail;
  /** Signed-in viewer; null for a guest, who sees the viewer actions like any non-owner. */
  readonly viewerId: string | null;
  readonly onReport: () => void;
  /** Post detail already exposes share, report and block in the header ⋮ menu (G1 step 4a). */
  readonly moderationInHeader?: boolean;
}

export function ListingDetailActions({ detail, viewerId, onReport, moderationInHeader = false }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const isOwner = viewerId !== null && viewerId === detail.ownerId;
  // A signed-in non-owner may block the owner; the listing is then hidden from them, so leave.
  const block = useUserBlock(isOwner ? '' : detail.ownerId);
  const blockOwner = () => {
    void block.toggle().then((changed) => {
      if (changed && router.canGoBack()) router.back();
    });
  };
  // The flow action (reserve, claim, book) is the screen's primary when the viewer has one.
  const MessageButton = listingFlowHasViewerAction(detail, viewerId) ? SecondaryButton : PrimaryButton;

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

  const shareLink = async () => {
    // Metro inlines EXPO_PUBLIC_* only at a literal read, so the variable is read here.
    const webBaseUrl = resolveWebBaseUrl({ EXPO_PUBLIC_WEB_BASE_URL: process.env.EXPO_PUBLIC_WEB_BASE_URL });
    const url = buildListingShareUrl(detail, webBaseUrl);
    await Share.share({ message: `${detail.title}\n${url}`, title: detail.title });
  };

  return (
    <View style={styles.actions}>
      {!isOwner ? (
        <MessageButton
          testID="listing-action-start-chat"
          label={t('marketplace.startChat')}
          size="md"
          disabled={busy}
          onPress={() => void startChat()}
        />
      ) : null}
      {!moderationInHeader ? (
        <SecondaryButton
          testID="listing-action-share-link"
          label={t('marketplace.shareLink')}
          size="md"
          onPress={() => void shareLink()}
        />
      ) : null}
      {!isOwner && !moderationInHeader ? (
        <SecondaryButton testID="listing-action-report" label={t('marketplace.report')} size="md" onPress={onReport} />
      ) : null}
      {!moderationInHeader && block.canBlock && !block.isBlocked ? (
        <SecondaryButton
          testID="listing-action-block-owner"
          label={t('moderation.block.block')}
          size="md"
          disabled={block.busy}
          onPress={blockOwner}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  actions: { gap: spacing.sm },
}));
