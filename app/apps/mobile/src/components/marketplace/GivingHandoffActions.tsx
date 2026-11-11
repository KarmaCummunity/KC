import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';
import { useAuthStore } from '../../store/authStore';
import { givingHandoffUseCases } from '../../services/givingHandoffComposition';
import { track } from '../../lib/analytics';
import { trackCoreLoop } from '../../lib/analyticsCoreLoop';
import { hapticSuccess } from '../../lib/haptics';
import { handoffErrorKey } from '../../lib/marketplaceCreateErrors';
import { HandoffRatingForm } from './HandoffRatingForm';
import { HandoffActionButton } from './HandoffActionButton';
import { GivingHandoffRequestButtons } from './GivingHandoffRequestButtons';
import { HANDOFF_WORLDS } from './listingFlow';
import { OwnerAssignUserButton } from '../closure/OwnerAssignUserButton';
import { useNetworkStatusStore } from '../../lib/networkStatusStore';
import { useOutboxStore } from '../../store/outboxStore';
import { useFeedSessionStore } from '../../store/feedSessionStore';

const OWNER_ASSIGN_WORLDS = ['items', 'food', 'animals'];

const useStyles = makeUseStyles(({ colors }) => ({
  box: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  status: { ...typography.caption, color: colors.textSecondary },
}));

interface Props {
  detail: MarketplaceListingDetail;
}

export function GivingHandoffActions({ detail }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const handoff = useQuery({
    queryKey: ['giving-handoff', detail.listingId],
    queryFn: () => givingHandoffUseCases.getForListing().execute(detail.listingId),
    enabled: Boolean(userId) && detail.direction === 'give',
  });

  if (detail.direction !== 'give') return null;
  // Rides manage many bookings per offer — see rides/RideBookingActions (D73).
  if (!HANDOFF_WORLDS.includes(detail.worldSlug)) return null;
  // Knowledge books by time slot, many learners per offer — see knowledge/KnowledgeBookingActions (#2034).
  if (detail.worldSlug === 'knowledge') return null;
  if (!userId) return null;
  if (detail.ownerId === userId && !handoff.data && !OWNER_ASSIGN_WORLDS.includes(detail.worldSlug)) return null;
  // The post detail screen docks the same assign action in the bottom chrome.
  if (detail.ownerId === userId && !handoff.data && detail.feedPostId) return null;

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['giving-handoff', detail.listingId] });
    await qc.invalidateQueries({ queryKey: ['marketplace'] });
    // Every detail query of this listing, by listing id or by post id (the post page, 0561), and
    // the post itself: a hand-over closes a post-form item's post (G34).
    await qc.invalidateQueries({ queryKey: ['marketplace-detail'] });
    await qc.invalidateQueries({ queryKey: ['post'] });
    await qc.invalidateQueries({ queryKey: ['giving-handoffs'] });
    await qc.invalidateQueries({ queryKey: ['feed'] });
  };

  const run = async (
    fn: () => Promise<void>,
    analytics?: 'match_made' | 'handover_completed',
    offlineAction?: {
      action: 'reserve_item' | 'claim_food' | 'confirm_handoff';
      payload: Record<string, unknown>;
    },
  ) => {
    if (!useNetworkStatusStore.getState().isOnline && offlineAction && userId) {
      const idempotencyKey = `handoff:${detail.listingId}:${userId}:${offlineAction.action}`;
      useOutboxStore.getState().enqueue({
        entityType: 'giving_handoff',
        action: offlineAction.action,
        payload: offlineAction.payload,
        idempotencyKey,
      });
      hapticSuccess();
      useFeedSessionStore.getState().showEphemeralToast(t('offlineSync.handoffPending'), 'success');
      return;
    }

    setBusy(true);
    try {
      await fn();
      if (analytics === 'match_made') {
        track('match_made', { world: detail.worldSlug });
      }
      if (analytics === 'handover_completed') {
        trackCoreLoop('handover_completed', { world: detail.worldSlug, cityId: detail.cityId });
      }
      hapticSuccess();
      await invalidate();
    } catch (err) {
      const errKey = handoffErrorKey(err);
      if (
        errKey === 'marketplace.errors.listing_not_available' ||
        errKey === 'marketplace.errors.item_already_reserved'
      ) {
        alert(t('offlineSync.handoffConflict'));
        await invalidate();
      } else {
        alert(t(errKey ?? 'givingHandoff.errorGeneric'));
      }
    } finally {
      setBusy(false);
    }
  };

  const h = handoff.data;
  const isOwner = userId === detail.ownerId;
  const isRecipient = h != null && userId === h.recipientId;
  // 'ongoing' is also the default availability of every new listing (create_marketplace_listing),
  // so it means "handed over" only once the listing has left the open state (0555 closes it).
  const isHandedOver = detail.availabilityStatus === 'ongoing' && detail.listingStatus !== 'open';
  const isAvailableForRequest = detail.availabilityStatus !== 'scheduled' && !isHandedOver;

  return (
    <View style={styles.box} testID="giving-handoff">
      <Text style={typography.h3}>{t('givingHandoff.sectionTitle')}</Text>
      {h ? (
        <Text style={styles.status} testID="giving-handoff-status">
          {t('givingHandoff.status', { status: t(`givingHandoff.statusLabel.${h.status}`, { defaultValue: h.status }) })}
        </Text>
      ) : null}

      {!h && detail.availabilityStatus === 'scheduled' ? (
        <Text style={styles.status} testID="giving-handoff-status">
          {t('givingHandoff.status', { status: t('givingHandoff.statusLabel.reserved', { defaultValue: 'Reserved' }) })}
        </Text>
      ) : null}

      {!h && isHandedOver ? (
        <Text style={styles.status} testID="giving-handoff-status">
          {t('givingHandoff.status', { status: t('givingHandoff.statusLabel.handed_over', { defaultValue: 'Handed over' }) })}
        </Text>
      ) : null}

      {/* `owner_complete_offer_with_user` refuses a post that is not open (0658). */}
      {isOwner && !h && !detail.feedPostId && detail.listingStatus === 'open' ? (
        <OwnerAssignUserButton targetId={detail.feedPostId ?? detail.listingId} worldSlug={detail.worldSlug} />
      ) : null}

      <GivingHandoffRequestButtons
        detail={detail}
        isOwner={isOwner}
        isAvailableForRequest={isAvailableForRequest}
        hasHandoff={Boolean(h)}
        busy={busy}
        run={run}
      />

      {h?.status === 'reserved' && isOwner ? (
        <>
          <HandoffActionButton
            testID="giving-handoff-confirm"
            label={t('givingHandoff.confirmReservation')}
            busy={busy}
            onPress={() => run(async () => { await givingHandoffUseCases.confirmItem().execute(h.handoffId); })}
          />
          <HandoffActionButton
            testID="giving-handoff-cancel"
            label={t('givingHandoff.cancel')}
            busy={busy}
            secondary
            onPress={() => run(async () => { await givingHandoffUseCases.cancel().execute(h.handoffId); })}
          />
        </>
      ) : null}

      {h?.status === 'reserved' && isRecipient ? (
        <HandoffActionButton
          testID="giving-handoff-cancel"
          label={t('givingHandoff.cancel')}
          busy={busy}
          secondary
          onPress={() => run(async () => { await givingHandoffUseCases.cancel().execute(h.handoffId); })}
        />
      ) : null}

      {h?.status === 'confirmed' && (isOwner || isRecipient) ? (
        <>
          <HandoffActionButton
            testID="giving-handoff-complete"
            label={t('givingHandoff.markHandedOver')}
            busy={busy}
            onPress={() => run(async () => { await givingHandoffUseCases.markHandedOver().execute(h.handoffId); }, 'handover_completed')}
          />
          <HandoffActionButton
            testID="giving-handoff-cancel"
            label={t('givingHandoff.cancel')}
            busy={busy}
            secondary
            onPress={() => run(async () => { await givingHandoffUseCases.cancel().execute(h.handoffId); })}
          />
        </>
      ) : null}

      {h?.status === 'handed_over' && (isOwner || isRecipient) ? (
        <HandoffRatingForm
          busy={busy}
          onSubmit={(rating, note) =>
            run(async () => {
              await givingHandoffUseCases.rate().execute(h.handoffId, rating, note);
              alert(t('givingHandoff.ratingThanks'));
            })
          }
        />
      ) : null}
    </View>
  );
}
