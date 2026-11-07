// Passenger view of a ride offer: ask to join with a seat count, then follow the booking —
// waiting (with its auto-cancel deadline, D96), approved, completed and rated
// (docs/spec/05_giving_worlds.md §5.3 step 3, D73; spec 07 §7.7).
import React, { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Text } from '@kc/ui';
import { isValidRideBookingSeats, type RidePlace } from '@kc/domain';
import { RidePlaceField } from '../../giving/RidePlaceField';
import { useRidePlaces } from '../../../hooks/useRidePlaces';
import { ridePlaceToMeetingPointPayload } from '../../../lib/rides/ridePlacePayload';
import { givingHandoffUseCases } from '../../../services/givingHandoffComposition';
import { rideBookingUseCases } from '../../../services/rideBookingComposition';
import { HandoffRatingForm } from '../HandoffRatingForm';
import { formatRideTime } from '../../cards/ListingCard';
import { HandoffActionButton } from '../HandoffActionButton';
import { RideEmergencyButton } from './RideEmergencyButton';
import { useRideBookingAction } from './useRideBookingAction';
import { useRideBookingStyles } from './rideBookingStyles';

interface Props {
  readonly listingId: string;
  readonly cityId: string | null;
  /** Seats the driver offered; caps the seat picker (the server re-checks what is left). */
  readonly capacity: number;
  /** The ride's details, for the emergency call window. */
  readonly details: Record<string, unknown>;
}

export function RidePassengerBooking({ listingId, cityId, capacity, details }: Props) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const { busy, run } = useRideBookingAction(listingId, cityId);
  const [seats, setSeats] = useState(1);
  const [rated, setRated] = useState(false);
  const [wantStop, setWantStop] = useState(false);
  const [requestedStop, setRequestedStop] = useState<RidePlace | null>(null);
  const placesQuery = useRidePlaces();
  // The caller's own active (or completed, unrated) booking on this ride.
  const booking = useQuery({
    queryKey: ['giving-handoff', listingId],
    queryFn: () => givingHandoffUseCases.getForListing().execute(listingId),
  });

  const h = booking.data;
  const departsAtRaw = details['departs_at'];
  const departsAtIso = typeof departsAtRaw === 'string' ? departsAtRaw : null;
  const departsTime = departsAtIso ? new Date(departsAtIso).getTime() : null;
  const isDeparted = departsTime !== null && !Number.isNaN(departsTime) && departsTime <= Date.now();
  const isFull = capacity <= 0;

  const maxSeats = Math.max(1, capacity);
  const changeSeats = (delta: number) => {
    const next = seats + delta;
    if (next <= maxSeats && isValidRideBookingSeats(next)) setSeats(next);
  };
  /** Withdraws the passenger's own booking, waiting or approved; `inRow` beside "complete trip". */
  const cancelMine = (handoffId: string, inRow = false) => (
    <HandoffActionButton
      inRow={inRow}
      testID="ride-booking-cancel-mine"
      label={t('rideBooking.cancelBooking')}
      busy={busy}
      secondary
      onPress={() => void run(() => rideBookingUseCases.cancel().execute(handoffId, { status: h?.status }))}
    />
  );

  return (
    <View style={styles.box} testID="ride-passenger-booking">
      <Text style={styles.title}>{t('rideBooking.passengerTitle')}</Text>

      {rated ? (
        <Text style={styles.caption} testID="ride-booking-completed-rated">
          {t('rideBooking.completedAndRated')}
        </Text>
      ) : null}

      {!h && booking.isSuccess && !rated ? (
        isDeparted ? (
          <Text style={styles.caption} testID="ride-booking-departed">
            {t('rideBooking.departed')}
          </Text>
        ) : isFull ? (
          <Text style={styles.caption} testID="ride-booking-full">
            {t('rideBooking.full')}
          </Text>
        ) : (
          <>
            <Text style={styles.caption}>{t('rideBooking.seatsToBook')}</Text>
            <View style={styles.stepper}>
              <StepperButton label="−" a11y={t('rideBooking.fewerSeats')} disabled={busy || seats <= 1} onPress={() => changeSeats(-1)} />
              <Text style={styles.stepperValue} testID="ride-booking-seats">{seats}</Text>
              <StepperButton label="+" a11y={t('rideBooking.moreSeats')} disabled={busy || seats >= maxSeats} onPress={() => changeSeats(1)} />
            </View>
            <View style={styles.stopRow}>
              <Text style={styles.caption}>{t('rideBooking.requestStopToggle')}</Text>
              <Switch
                accessibilityRole="switch"
                value={wantStop}
                onValueChange={setWantStop}
                disabled={busy}
                testID="ride-booking-stop-toggle"
              />
            </View>
            {wantStop ? (
              <>
                <Text style={styles.caption}>{t('rideBooking.requestStopHint')}</Text>
                <RidePlaceField
                  label={t('rideBooking.requestStopLabel')}
                  value={requestedStop}
                  places={placesQuery.data ?? null}
                  isLoading={placesQuery.isLoading}
                  error={placesQuery.error}
                  onRetry={() => void placesQuery.refetch()}
                  onChange={setRequestedStop}
                  disabled={busy}
                />
              </>
            ) : null}
            <HandoffActionButton
              testID="giving-handoff-book-seat"
              label={t('rideBooking.book')}
              busy={busy}
              disabled={wantStop && !requestedStop}
              onPress={() =>
                void run(
                  () =>
                    rideBookingUseCases.book().execute(
                      listingId,
                      seats,
                      { capacity, departsAt: departsAtIso },
                      {
                        requestedMeetingPoint:
                          wantStop && requestedStop ? ridePlaceToMeetingPointPayload(requestedStop) : null,
                      },
                    ),
                  'match_made',
                )
              }
            />
          </>
        )
      ) : null}

      {h?.status === 'reserved' ? (
        <>
          <Text style={styles.caption} testID="ride-booking-waiting">
            {t('rideBooking.waitingForDriver', { time: formatRideTime(h.confirmBy) ?? '' })}
          </Text>
          {cancelMine(h.handoffId)}
        </>
      ) : null}

      {h?.status === 'confirmed' ? (
        <>
          <Text style={styles.caption} testID="ride-booking-confirmed">{t('rideBooking.confirmed')}</Text>
          {/* An approved passenger is on the ride: the emergency call shows while it is under way. */}
          <RideEmergencyButton listingId={listingId} details={details} />
          <View style={styles.actions}>
            <HandoffActionButton
              inRow
              testID="giving-handoff-complete"
              label={t('rideBooking.completeTrip')}
              busy={busy}
              onPress={() =>
                void run(
                  () => rideBookingUseCases.complete().execute(h.handoffId, { status: h.status, departsAt: departsAtIso }),
                  'handover_completed',
                )
              }
            />
            {cancelMine(h.handoffId, true)}
          </View>
        </>
      ) : null}

      {h?.status === 'handed_over' && !rated ? (
        <HandoffRatingForm
          busy={busy}
          onSubmit={(rating, note) =>
            void run(async () => {
              await givingHandoffUseCases.rate().execute(h.handoffId, rating, note);
              setRated(true);
              alert(t('givingHandoff.ratingThanks'));
            })
          }
        />
      ) : null}
    </View>
  );
}

interface StepperButtonProps {
  readonly label: string;
  readonly a11y: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

function StepperButton({ label, a11y, disabled, onPress }: StepperButtonProps) {
  const styles = useRideBookingStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[styles.stepperBtn, disabled && { opacity: 0.4 }]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.stepperValue}>{label}</Text>
    </Pressable>
  );
}
