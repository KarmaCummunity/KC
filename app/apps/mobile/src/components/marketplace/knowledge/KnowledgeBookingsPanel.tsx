// Giver view of a knowledge lesson or consulting hour (FR-KNOW-004 AC2–AC3, #2034): every booking
// of the post, soonest time first, each with the actions its state allows — approve or decline a
// waiting one before its deadline, mark an approved one held or cancel it, rate the learner after
// the session, and message the learner to settle the details.
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Text } from '@kc/ui';
import { canCompleteKnowledgeSession, type KnowledgeBooking } from '@kc/domain';
import { useAuthStore } from '../../../store/authStore';
import { givingHandoffUseCases } from '../../../services/givingHandoffComposition';
import {
  knowledgeBookingsQueryKey,
  knowledgeBookingUseCases,
  openKnowledgeLearnerChat,
} from '../../../services/knowledgeBookingComposition';
import { formatRideTime } from '../../cards/ListingCard';
import { HandoffActionButton } from '../HandoffActionButton';
import { HandoffRatingForm } from '../HandoffRatingForm';
import { useRideBookingStyles } from '../rides/rideBookingStyles';
import { useKnowledgeBookingAction } from './useKnowledgeBookingAction';
import { listOrEmpty } from '../../../lib/backendAvailability';

interface Props {
  readonly listingId: string;
  readonly cityId: string | null;
}

type Run = ReturnType<typeof useKnowledgeBookingAction>['run'];

export function KnowledgeBookingsPanel({ listingId, cityId }: Props) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const { busy, run } = useKnowledgeBookingAction(listingId, cityId);
  const bookings = useQuery({
    queryKey: knowledgeBookingsQueryKey(listingId),
    queryFn: () => listOrEmpty(() => knowledgeBookingUseCases.listBookings().execute(listingId)),
  });

  return (
    <View style={styles.box} testID="knowledge-bookings-panel">
      <Text style={styles.title}>{t('knowledgeBooking.giverTitle')}</Text>
      {bookings.isError ? <Text style={styles.caption}>{t('knowledgeBooking.loadError')}</Text> : null}
      {bookings.isSuccess && bookings.data.length === 0 ? (
        <Text style={styles.caption} testID="knowledge-bookings-empty">
          {t('knowledgeBooking.noBookings')}
        </Text>
      ) : null}
      {(bookings.data ?? []).map((booking) => (
        <KnowledgeBookingRow key={booking.handoffId} booking={booking} busy={busy} run={run} />
      ))}
    </View>
  );
}

function KnowledgeBookingRow({ booking, busy, run }: { booking: KnowledgeBooking; busy: boolean; run: Run }) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const id = booking.handoffId;
  const status =
    booking.status === 'cancelled' && booking.cancelReason
      ? t(`knowledgeBooking.cancelReason.${booking.cancelReason}`, { defaultValue: t('knowledgeBooking.statusLabel.cancelled') })
      : t(`knowledgeBooking.statusLabel.${booking.status}`);

  return (
    <View style={styles.row} testID={`knowledge-booking-${id}`}>
      <Text style={styles.name}>{booking.learnerName || t('knowledgeBooking.learnerFallback')}</Text>
      <Text style={styles.caption}>
        {[formatRideTime(booking.startsAt), status].filter(Boolean).join(' · ')}
      </Text>
      {booking.status === 'reserved' && booking.confirmBy ? (
        <Text style={styles.warning}>{t('knowledgeBooking.answerBy', { time: formatRideTime(booking.confirmBy) })}</Text>
      ) : null}
      <BookingActions booking={booking} busy={busy} run={run} />
    </View>
  );
}

/** The giver's actions for one booking, by its state. */
function BookingActions({ booking, busy, run }: { booking: KnowledgeBooking; busy: boolean; run: Run }) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const router = useRouter();
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const id = booking.handoffId;

  if (booking.status === 'handed_over') {
    return (
      <HandoffRatingForm
        busy={busy}
        onSubmit={(rating, note) =>
          void run(async () => {
            await givingHandoffUseCases.rate().execute(id, rating, note);
            alert(t('givingHandoff.ratingThanks'));
          })
        }
      />
    );
  }
  if (booking.status !== 'reserved' && booking.status !== 'confirmed') return null;

  // Opens (or creates) the one chat with this learner (D13) to settle the meeting details.
  const openChat = async () => {
    if (!viewerId) return;
    const chatId = await openKnowledgeLearnerChat(viewerId, booking.learnerId);
    router.push(`/chat/${chatId}`);
  };

  return (
    <View style={styles.actions}>
      {booking.status === 'reserved' ? (
        <>
          <HandoffActionButton
            inRow
            testID={`knowledge-booking-confirm-${id}`}
            label={t('knowledgeBooking.confirm')}
            busy={busy}
            onPress={() => void run(() => knowledgeBookingUseCases.confirm().execute(id), 'match_made')}
          />
          <HandoffActionButton
            inRow
            secondary
            testID={`knowledge-booking-decline-${id}`}
            label={t('knowledgeBooking.decline')}
            busy={busy}
            onPress={() => void run(() => knowledgeBookingUseCases.decline().execute(id))}
          />
        </>
      ) : (
        <>
          {canCompleteKnowledgeSession(booking) ? (
            <HandoffActionButton
              inRow
              testID={`knowledge-booking-complete-${id}`}
              label={t('knowledgeBooking.complete')}
              busy={busy}
              onPress={() => void run(() => knowledgeBookingUseCases.complete().execute(booking), 'handover_completed')}
            />
          ) : null}
          <HandoffActionButton
            inRow
            secondary
            testID={`knowledge-booking-cancel-${id}`}
            label={t('knowledgeBooking.cancel')}
            busy={busy}
            onPress={() => void run(() => givingHandoffUseCases.cancel().execute(id))}
          />
        </>
      )}
      <HandoffActionButton
        inRow
        secondary
        testID={`knowledge-booking-chat-${id}`}
        label={t('knowledgeBooking.chat')}
        busy={busy}
        onPress={() => void run(openChat)}
      />
    </View>
  );
}
