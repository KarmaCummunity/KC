// Learner view of a knowledge lesson or consulting hour (FR-KNOW-004 AC2–AC3, #2034): every
// upcoming time with its places left, a "book a place" per time, and — on a time the learner booked —
// its state with the actions that state allows: cancel, mark the session held, rate it.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Text } from '@kc/ui';
import {
  canBookKnowledgeSlot,
  canCompleteKnowledgeSession,
  givingHandoffActions,
  isGivingHandoffLive,
  type KnowledgeSlot,
} from '@kc/domain';
import { givingHandoffUseCases } from '../../../services/givingHandoffComposition';
import { knowledgeBookingUseCases, knowledgeSlotsQueryKey } from '../../../services/knowledgeBookingComposition';
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

export function KnowledgeSlotPicker({ listingId, cityId }: Props) {
  const { t } = useTranslation();
  // Shared with the rides booking views, so every booking box looks the same.
  const styles = useRideBookingStyles();
  const { busy, run } = useKnowledgeBookingAction(listingId, cityId);
  const slots = useQuery({
    queryKey: knowledgeSlotsQueryKey(listingId),
    queryFn: () => listOrEmpty(() => knowledgeBookingUseCases.listSlots().execute(listingId)),
  });
  const firstBookable = (slots.data ?? []).find((slot) => canBookKnowledgeSlot(slot));

  return (
    <View style={styles.box} testID="knowledge-slot-picker">
      <Text style={styles.title}>{t('knowledgeBooking.learnerTitle')}</Text>
      {slots.isError ? <Text style={styles.caption}>{t('knowledgeBooking.loadError')}</Text> : null}
      {slots.isSuccess && slots.data.length === 0 ? (
        <Text style={styles.caption} testID="knowledge-slot-picker-empty">
          {t('knowledgeBooking.noSlots')}
        </Text>
      ) : null}
      {(slots.data ?? []).map((slot) => (
        <KnowledgeSlotChoice
          key={slot.slotId}
          slot={slot}
          busy={busy}
          run={run}
          // One primary per screen (spec 17): the soonest bookable time; the others are outlined.
          primary={slot.slotId === firstBookable?.slotId}
        />
      ))}
    </View>
  );
}

function KnowledgeSlotChoice({ slot, busy, run, primary }: { slot: KnowledgeSlot; busy: boolean; run: Run; primary: boolean }) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const id = slot.slotId;
  const seats = slot.seatsLeft > 0 ? t('knowledgeBooking.seatsLeft', { count: slot.seatsLeft }) : t('knowledgeBooking.full');
  const handoffId = slot.myHandoffId;

  return (
    <View style={styles.row} testID={`knowledge-slot-choice-${id}`}>
      <Text style={styles.name}>{formatRideTime(slot.startsAt)}</Text>
      {!slot.myStatus || slot.myStatus === 'cancelled' ? <Text style={styles.caption}>{seats}</Text> : null}
      {canBookKnowledgeSlot(slot) ? (
        <HandoffActionButton
          testID={`knowledge-slot-book-${id}`}
          label={t('knowledgeBooking.book')}
          busy={busy}
          secondary={!primary}
          onPress={() => void run(() => knowledgeBookingUseCases.book().execute(slot), 'match_made')}
        />
      ) : null}
      {handoffId && slot.myStatus ? <MyBooking slot={slot} handoffId={handoffId} busy={busy} run={run} /> : null}
    </View>
  );
}

/** The learner's own booking on a time: what it waits for, and what they can do now. */
function MyBooking({ slot, handoffId, busy, run }: { slot: KnowledgeSlot; handoffId: string; busy: boolean; run: Run }) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const booking = { handoffId, status: slot.myStatus!, startsAt: slot.startsAt };
  // The learner is the recipient of the booking; the handoff graph says what they may do with it.
  const actions = givingHandoffActions(booking.status, 'recipient');

  if (actions.rate) {
    return (
      <HandoffRatingForm
        busy={busy}
        onSubmit={(rating, note) =>
          void run(async () => {
            await givingHandoffUseCases.rate().execute(handoffId, rating, note);
            alert(t('givingHandoff.ratingThanks'));
          })
        }
      />
    );
  }
  if (!isGivingHandoffLive(booking.status)) return null;
  return (
    <>
      <Text style={styles.caption} testID={`knowledge-my-booking-${slot.slotId}`}>
        {booking.status === 'reserved'
          ? t('knowledgeBooking.waitingForGiver')
          : t('knowledgeBooking.confirmed')}
      </Text>
      <View style={styles.actions}>
        {canCompleteKnowledgeSession(booking, 'recipient') ? (
          <HandoffActionButton
            inRow
            testID={`knowledge-my-booking-complete-${slot.slotId}`}
            label={t('knowledgeBooking.complete')}
            busy={busy}
            onPress={() => void run(() => knowledgeBookingUseCases.complete().execute(booking, 'recipient'), 'handover_completed')}
          />
        ) : null}
        {actions.cancel ? (
          <HandoffActionButton
            inRow
            secondary
            testID={`knowledge-my-booking-cancel-${slot.slotId}`}
            label={t('knowledgeBooking.cancelBooking')}
            busy={busy}
            onPress={() => void run(() => givingHandoffUseCases.cancel().execute(handoffId))}
          />
        ) : null}
      </View>
    </>
  );
}
