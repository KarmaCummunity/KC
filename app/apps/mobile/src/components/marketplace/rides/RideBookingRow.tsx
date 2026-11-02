// One booking in the driver's passenger list: who, how many seats, its state and the actions
// that state allows — approve/decline a waiting booking, complete/cancel an approved one, and
// rate the passenger once after the trip (spec 05 §5.3 step 3, D73; spec 07 §7.7).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import type { RideBooking } from '@kc/domain';
import { HandoffRatingForm } from '../HandoffRatingForm';
import { HandoffActionButton } from '../HandoffActionButton';
import { formatRideTime } from '../../cards/ListingCard';
import { useRideBookingStyles } from './rideBookingStyles';

export interface RideBookingRowActions {
  readonly approve: (handoffId: string) => void;
  readonly decline: (handoffId: string) => void;
  readonly complete: (handoffId: string) => void;
  readonly cancel: (handoffId: string) => void;
  readonly rate: (handoffId: string, rating: number, note: string | null) => void;
}

interface Props {
  readonly booking: RideBooking;
  readonly busy: boolean;
  readonly actions: RideBookingRowActions;
}

/** The driver's action pair per booking state: the main action and its outlined alternative. */
const ACTION_PAIRS = {
  reserved: { main: 'approve', mainLabel: 'rideBooking.approve', other: 'decline', otherLabel: 'rideBooking.decline' },
  confirmed: { main: 'complete', mainLabel: 'rideBooking.completeTrip', other: 'cancel', otherLabel: 'rideBooking.cancel' },
} as const;

export function RideBookingRow({ booking, busy, actions }: Props) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const id = booking.handoffId;
  const deadline = booking.status === 'reserved' ? formatRideTime(booking.confirmBy) : null;
  const pair = booking.status === 'reserved' || booking.status === 'confirmed' ? ACTION_PAIRS[booking.status] : null;

  return (
    <View style={styles.row} testID={`ride-booking-${id}`}>
      <Text style={styles.name}>{booking.passengerName || t('rideBooking.passengerFallback')}</Text>
      <Text style={styles.caption}>
        {t('rideBooking.seatsCount', { count: booking.seats })} · {t(`rideBooking.statusLabel.${booking.status}`)}
      </Text>
      {deadline ? <Text style={styles.caption}>{t('rideBooking.approveBy', { time: deadline })}</Text> : null}

      {pair ? (
        <View style={styles.actions}>
          <HandoffActionButton inRow testID={`ride-booking-${pair.main}-${id}`} label={t(pair.mainLabel)} busy={busy} onPress={() => actions[pair.main](id)} />
          <HandoffActionButton inRow secondary testID={`ride-booking-${pair.other}-${id}`} label={t(pair.otherLabel)} busy={busy} onPress={() => actions[pair.other](id)} />
        </View>
      ) : null}

      {booking.status === 'handed_over' && !booking.ratedByMe ? (
        <HandoffRatingForm busy={busy} onSubmit={(rating, note) => actions.rate(id, rating, note)} />
      ) : null}
    </View>
  );
}
