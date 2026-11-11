// One booking on the host's stay offer (FR-HOUSING-016, 018–021, 036 AC2): the guest's trust
// block — verification, completed stays, seniority, never a rating (S16, D24) — the dates, the
// party, the guest's message and only the actions the rules allow right now.
import React from 'react';
import { View } from 'react-native';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import { hostBookingActions, type HousingHostBooking } from '@kc/domain';
import { HandoffActionButton } from '../HandoffActionButton';
import { HandoffRatingForm } from '../HandoffRatingForm';
import { useRideBookingStyles } from '../rides/rideBookingStyles';

export interface HousingHostRowActions {
  readonly approve: (booking: HousingHostBooking) => void;
  readonly decline: (booking: HousingHostBooking) => void;
  readonly cancel: (booking: HousingHostBooking) => void;
  readonly complete: (booking: HousingHostBooking) => void;
  readonly noShow: (booking: HousingHostBooking) => void;
  readonly rate: (booking: HousingHostBooking, rating: number, note: string | null) => void;
  readonly chat: (booking: HousingHostBooking) => void;
}

interface Props {
  readonly booking: HousingHostBooking;
  readonly busy: boolean;
  readonly actions: HousingHostRowActions;
}

export function HousingHostBookingRow({ booking, busy, actions }: Props) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const allowed = hostBookingActions(booking, new Date());
  const id = booking.handoffId;
  const party = booking.minors > 0
    ? t('housingStay.party', { adults: booking.adults, minors: booking.minors })
    : t('housingStay.partyAdults', { adults: booking.adults });

  return (
    <View style={styles.row} testID={`housing-booking-${id}`}>
      <Text style={styles.name}>{booking.guestName || t('housingStay.guestFallback')}</Text>
      <Text style={styles.caption}>
        {[
          booking.guestVerified ? t('housingStay.verified') : null,
          t('housingStay.completedStays', { count: booking.guestCompletedStays }),
          t('housingStay.memberSince', { date: format(new Date(booking.guestMemberSince), 'MM/yyyy') }),
        ].filter(Boolean).join(' · ')}
      </Text>
      <Text style={styles.caption}>
        {t('housingStay.stayDates', { from: booking.checkInDate, to: booking.checkOutDate })}
        {' · '}
        {party}
        {' · '}
        {t(`housingStay.statusLabel.${booking.status}`)}
      </Text>
      {booking.message ? <Text style={styles.caption}>{booking.message}</Text> : null}
      {booking.status === 'reserved' && booking.confirmBy ? (
        <Text style={styles.warning}>{t('housingStay.answerBy', { time: format(new Date(booking.confirmBy), 'dd/MM HH:mm') })}</Text>
      ) : null}
      <View style={styles.actions}>
        {allowed.includes('approve') ? (
          <HandoffActionButton testID={`housing-approve-${id}`} label={t('housingStay.approve')} busy={busy} inRow onPress={() => actions.approve(booking)} />
        ) : null}
        {allowed.includes('decline') ? (
          <HandoffActionButton testID={`housing-decline-${id}`} label={t('housingStay.decline')} busy={busy} inRow secondary onPress={() => actions.decline(booking)} />
        ) : null}
        {allowed.includes('complete') ? (
          <HandoffActionButton testID={`housing-complete-${id}`} label={t('housingStay.complete')} busy={busy} inRow onPress={() => actions.complete(booking)} />
        ) : null}
        {allowed.includes('no_show') ? (
          <HandoffActionButton testID={`housing-no-show-${id}`} label={t('housingStay.noShow')} busy={busy} inRow secondary onPress={() => actions.noShow(booking)} />
        ) : null}
        {allowed.includes('cancel') ? (
          <HandoffActionButton testID={`housing-host-cancel-${id}`} label={t('housingStay.hostCancel')} busy={busy} inRow secondary onPress={() => actions.cancel(booking)} />
        ) : null}
        <HandoffActionButton testID={`housing-chat-${id}`} label={t('housingStay.chat')} busy={busy} inRow secondary onPress={() => actions.chat(booking)} />
      </View>
      {booking.status === 'handed_over' && !booking.ratedByMe ? (
        <HandoffRatingForm busy={busy} onSubmit={(rating, note) => actions.rate(booking, rating, note)} />
      ) : null}
    </View>
  );
}
