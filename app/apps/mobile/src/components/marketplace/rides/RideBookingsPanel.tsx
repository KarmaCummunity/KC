// Driver view of a ride offer: seat summary and every booking with its actions
// (docs/spec/05_giving_worlds.md §5.3 step 3 — the driver approves or declines each, D73).
import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, Text, useTheme } from '@kc/ui';
import { canApproveRideBooking, canReinstateRideBooking, summarizeRideSeats } from '@kc/domain';
import { useAuthStore } from '../../../store/authStore';
import { givingHandoffUseCases } from '../../../services/givingHandoffComposition';
import {
  openRidePassengerChat,
  rideBookingsQueryKey,
  rideBookingUseCases,
} from '../../../services/rideBookingComposition';
import { RideBookingRow, type RideBookingRowActions } from './RideBookingRow';
import { HandoffActionButton } from '../HandoffActionButton';
import { confirmAction } from '../../../services/platformConfirm';
import { useRideBookingAction } from './useRideBookingAction';
import { useRideBookingsPanelStyles } from './rideBookingsPanelStyles';
import { RideSeatsMeter } from './RideSeatsMeter';
import { OwnerAssignUserButton } from '../../closure/OwnerAssignUserButton';

interface Props {
  readonly listingId: string;
  readonly cityId: string | null;
  /** Seats the driver offered (`details.seats_available`). */
  readonly capacity: number;
  readonly listingStatus: string;
  readonly departsAt: string | null;
  /** Post detail docks assign in the bottom chrome instead of this panel. */
  readonly hideOwnerAssign?: boolean;
}

export function RideBookingsPanel({
  listingId,
  cityId,
  capacity,
  listingStatus,
  departsAt,
  hideOwnerAssign = false,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useRideBookingsPanelStyles();
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const { busy, run } = useRideBookingAction(listingId, cityId);
  const bookings = useQuery({
    queryKey: rideBookingsQueryKey(listingId),
    queryFn: () => rideBookingUseCases.listForRide().execute(listingId),
  });

  const list = bookings.data ?? [];
  const seats = summarizeRideSeats(capacity, list);
  const hasReinstatable = list.some((b) => canReinstateRideBooking(b));
  const canFinishRide = listingStatus === 'open'
    && departsAt !== null
    && Number.isFinite(Date.parse(departsAt))
    && Date.parse(departsAt) <= Date.now() + 60 * 60 * 1000;

  async function finishRide(): Promise<void> {
    const confirmed = await confirmAction(t('rideBooking.finishRideConfirmTitle'), t('rideBooking.finishRideConfirmMessage'), {
      destructive: true,
    });
    if (!confirmed) return;
    await run(() => rideBookingUseCases.completeRide().execute(listingId), 'handover_completed');
  }

  const onChat = async (recipientId: string) => {
    if (!viewerId) return;
    try {
      const chatId = await openRidePassengerChat(viewerId, recipientId);
      router.push(`/chat/${chatId}`);
    } catch {
      alert(t('givingHandoff.errorGeneric'));
    }
  };

  const actions: RideBookingRowActions = {
    approve: (id) => void run(() => rideBookingUseCases.approve().execute(id, { capacity, bookings: list }), 'match_made'),
    decline: (id) => void run(() => rideBookingUseCases.decline().execute(id, { bookings: list })),
    complete: (id) => void run(() => rideBookingUseCases.complete().execute(id, { bookings: list }), 'handover_completed'),
    cancel: (id) => void run(() => rideBookingUseCases.cancel().execute(id, { bookings: list })),
    rate: (id, rating, note) =>
      void run(async () => {
        await givingHandoffUseCases.rate().execute(id, rating, note);
        alert(t('givingHandoff.ratingThanks'));
      }),
    chat: (recipientId) => void onChat(recipientId),
    reinstate: (id) =>
      void run(
        () => rideBookingUseCases.reinstate().execute(id, { bookings: list }),
        'match_made',
      ),
  };

  return (
    <View style={styles.card} testID="ride-bookings-panel">
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="people" size={iconSize.md} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('rideBooking.driverTitle')}</Text>
          <Text style={styles.caption} testID="ride-bookings-seats">
            {t('rideBooking.seatSummary', { free: seats.free, capacity: seats.capacity })}
          </Text>
        </View>
      </View>
      <RideSeatsMeter seats={seats} />
      {seats.waiting > 0 ? (
        <View style={styles.notice}>
          <Ionicons name="time-outline" size={iconSize.sm} color={colors.textPrimary} />
          <Text style={styles.noticeText}>{t('rideBooking.waitingSummary', { count: seats.waiting })}</Text>
        </View>
      ) : null}
      {canFinishRide ? <HandoffActionButton
        testID="ride-complete-listing"
        label={t('rideBooking.finishRide')}
        busy={busy}
        onPress={() => void finishRide()}
      /> : null}

      {bookings.isError ? (
        <Pressable accessibilityRole="button" onPress={() => void bookings.refetch()} testID="ride-bookings-retry">
          <Text style={styles.caption}>{t('rideBooking.loadError')}</Text>
        </Pressable>
      ) : null}
      {hasReinstatable ? (
        <Text style={styles.caption} testID="ride-bookings-reinstate-hint">{t('rideBooking.reinstateHint')}</Text>
      ) : null}
      {bookings.isSuccess && list.length === 0 ? (
        <View style={styles.empty} testID="ride-bookings-empty">
          <Ionicons name="person-add-outline" size={iconSize.lg} color={colors.textDisabled} />
          <Text style={styles.emptyText}>{t('rideBooking.empty')}</Text>
        </View>
      ) : null}
      {listingStatus === 'open' && !hideOwnerAssign ? (
        <OwnerAssignUserButton targetId={listingId} worldSlug="rides" />
      ) : null}

      {list.length > 0 ? (
        <View style={styles.list}>
          {list.map((booking) => (
            <RideBookingRow
              key={booking.handoffId}
              booking={booking}
              busy={busy}
              actions={actions}
              canApprove={canApproveRideBooking(capacity, list, booking)}
              canReinstate={canReinstateRideBooking(booking)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
