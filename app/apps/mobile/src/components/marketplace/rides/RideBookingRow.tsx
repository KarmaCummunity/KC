// One booking in the driver's passenger list: who, how many seats, its state and the actions
// that state allows — approve/decline a waiting booking, complete/cancel an approved one, and
// rate the passenger once after the trip (spec 05 §5.3 step 3, D73; spec 07 §7.7).
import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, Text, useTheme } from '@kc/ui';
import { canPerformBookingAction, type RideBooking, type RideBookingAction } from '@kc/domain';
import { HandoffRatingForm } from '../HandoffRatingForm';
import { HandoffActionButton } from '../HandoffActionButton';
import { formatRideTime } from '../../cards/ListingCard';
import { AvatarInitials } from '../../AvatarInitials';
import { statusTone, useRideBookingsPanelStyles } from './rideBookingsPanelStyles';

export interface RideBookingRowActions {
  readonly approve: (handoffId: string) => void;
  readonly decline: (handoffId: string) => void;
  readonly complete: (handoffId: string) => void;
  readonly cancel: (handoffId: string) => void;
  readonly rate: (handoffId: string, rating: number, note: string | null) => void;
  readonly reinstate?: (handoffId: string) => void;
  readonly chat?: (recipientId: string) => void;
}

interface Props {
  readonly booking: RideBooking;
  readonly busy: boolean;
  readonly actions: RideBookingRowActions;
  /** False when approving this booking would exceed remaining ride capacity. */
  readonly canApprove?: boolean;
  /** True when the driver may bring this booking back now: one they declined or cancelled, on a ride that can take it. */
  readonly canReinstate?: boolean;
  /** False before the trip may be completed (from an hour before departure). */
  readonly canComplete?: boolean;
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The driver's two action pairs, the main action and its outlined alternative: a waiting
 * booking is answered, an approved one is settled.
 */
const ACTION_PAIRS = {
  answer: { main: 'approve', mainLabel: 'rideBooking.approve', other: 'decline', otherLabel: 'rideBooking.decline' },
  settle: { main: 'complete', mainLabel: 'rideBooking.completeTrip', other: 'cancel', otherLabel: 'rideBooking.cancel' },
} as const;

function InfoLine({ icon, text, warning = false, testID }: { icon: IconName; text: string; warning?: boolean; testID?: string }) {
  const { colors } = useTheme();
  const styles = useRideBookingsPanelStyles();
  return (
    <View style={styles.infoLine} testID={testID}>
      <Ionicons name={icon} size={iconSize.sm} color={warning ? colors.error : colors.textSecondary} />
      <Text style={warning ? styles.warningText : styles.infoText}>{text}</Text>
    </View>
  );
}

export function RideBookingRow({
  booking,
  busy,
  actions,
  canApprove = true,
  canReinstate = false,
  canComplete = true,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useRideBookingsPanelStyles();
  const id = booking.handoffId;
  const name = booking.passengerName || t('rideBooking.passengerFallback');
  // What the driver may do with the booking, read from the ride booking graph.
  const may = (action: RideBookingAction): boolean =>
    canPerformBookingAction(booking.status, action, booking.ratedByMe, 'owner');
  // A booking that can still be answered shows the answer pair; the driver settles it afterwards.
  const pair = may('approve') ? ACTION_PAIRS.answer : may('complete') ? ACTION_PAIRS.settle : null;
  const deadline = pair === ACTION_PAIRS.answer ? formatRideTime(booking.confirmBy) : null;
  const isApproveBlocked = pair === ACTION_PAIRS.answer && !canApprove;
  const isCompleteBlocked = pair === ACTION_PAIRS.settle && !canComplete;
  const tone = statusTone(booking.status, colors);

  return (
    <View style={[styles.passenger, booking.status === 'cancelled' && styles.passengerMuted]} testID={`ride-booking-${id}`}>
      <View style={styles.passengerHead}>
        <AvatarInitials name={name} avatarUrl={booking.avatarUrl} size={44} />
        <View style={styles.passengerText}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.pill, { backgroundColor: tone.bg }]}>
              <View style={[styles.pillDot, { backgroundColor: tone.dot }]} />
              <Text style={styles.pillText}>{t(`rideBooking.statusLabel.${booking.status}`)}</Text>
            </View>
            <View style={styles.meta}>
              <Ionicons name="person-outline" size={iconSize.xs} color={colors.textSecondary} />
              <Text style={styles.metaText}>{t('rideBooking.seatsCount', { count: booking.seats })}</Text>
            </View>
          </View>
        </View>
        {pair && actions.chat ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('rideBooking.chat')}
            disabled={busy}
            style={styles.chatBtn}
            testID={`ride-booking-chat-${id}`}
            onPress={() => actions.chat?.(booking.recipientId)}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={iconSize.md} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      {deadline ? <InfoLine icon="hourglass-outline" text={t('rideBooking.approveBy', { time: deadline })} /> : null}
      {booking.requestedStopLabel ? (
        <InfoLine
          icon="location-outline"
          testID={`ride-booking-stop-${id}`}
          text={t('rideBooking.requestedStopForDriver', { place: booking.requestedStopLabel })}
        />
      ) : null}
      {isApproveBlocked ? (
        <InfoLine icon="alert-circle-outline" warning testID={`ride-booking-exceeds-${id}`} text={t('rideBooking.exceedsCapacity')} />
      ) : null}
      {isCompleteBlocked ? (
        <InfoLine icon="time-outline" testID={`ride-booking-complete-later-${id}`} text={t('rideBooking.completeFromHourBefore')} />
      ) : null}

      {canReinstate && actions.reinstate ? (
        <View style={styles.actions}>
          <HandoffActionButton
            inRow
            testID={`ride-booking-reinstate-${id}`}
            label={t('rideBooking.reinstate')}
            busy={busy}
            onPress={() => actions.reinstate?.(id)}
          />
        </View>
      ) : null}

      {pair ? (
        <View style={styles.actions}>
          <HandoffActionButton
            inRow
            testID={`ride-booking-${pair.main}-${id}`}
            label={t(pair.mainLabel)}
            busy={busy}
            disabled={(pair.main === 'approve' && isApproveBlocked) || (pair.main === 'complete' && isCompleteBlocked)}
            onPress={() => actions[pair.main](id)}
          />
          <HandoffActionButton inRow secondary testID={`ride-booking-${pair.other}-${id}`} label={t(pair.otherLabel)} busy={busy} onPress={() => actions[pair.other](id)} />
        </View>
      ) : null}

      {may('rate') ? (
        <HandoffRatingForm busy={busy} onSubmit={(rating, note) => actions.rate(id, rating, note)} />
      ) : null}
    </View>
  );
}
