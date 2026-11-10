// The guest's side of a stay offer (FR-HOUSING-015, 018, 012, 021): request a stay — after the
// code of conduct (FR-HOUSING-003 AC3) — then follow it: waiting, confirmed with the address,
// completed with the rating; cancel before check-in.
import React, { useState } from 'react';
import { View } from 'react-native';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Text, typography } from '@kc/ui';
import {
  guestStayActions,
  housingToday,
  isLateHousingCancel,
  type HousingGuestStay,
  type HousingOfferTerms,
  type HousingStayRequestInput,
} from '@kc/domain';
import { housingQueryKeys, housingUseCases } from '../../../services/housingComposition';
import { givingHandoffUseCases } from '../../../services/givingHandoffComposition';
import { confirmAction } from '../../../services/platformConfirm';
import { HandoffActionButton } from '../HandoffActionButton';
import { HandoffRatingForm } from '../HandoffRatingForm';
import { useRideBookingStyles } from '../rides/rideBookingStyles';
import { HousingAddressCard } from './HousingAddressCard';
import { HousingConductModal } from './HousingConductModal';
import { HousingStayRequestForm } from './HousingStayRequestForm';
import { useHousingAction } from './useHousingAction';

interface Props {
  readonly listingId: string;
  readonly terms: HousingOfferTerms;
}

/** Stays that still hold a place on this offer; finished ones are history in "my stays". */
const LIVE: readonly HousingGuestStay['status'][] = ['reserved', 'confirmed', 'handed_over'];

export function HousingGuestPanel({ listingId, terms }: Props) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const { busy, run } = useHousingAction(listingId);
  const [conductOpen, setConductOpen] = useState(false);
  const [pending, setPending] = useState<HousingStayRequestInput | null>(null);
  const stays = useQuery({
    queryKey: housingQueryKeys.myStays,
    queryFn: () => housingUseCases.listMyStays().execute(),
  });
  const conduct = useQuery({ queryKey: housingQueryKeys.conduct, queryFn: () => housingUseCases.conductStatus().execute() });
  const stay = (stays.data ?? []).find((s) => s.listingId === listingId && LIVE.includes(s.status)) ?? null;

  const send = (input: HousingStayRequestInput) =>
    void run(() => housingUseCases.requestStay().execute(input, terms, housingToday(new Date())));

  /**
   * The conduct comes first; the request waits for the acceptance and is then sent. A status
   * still loading is awaited, so a member who already accepted is never asked again.
   */
  const submit = async (input: HousingStayRequestInput) => {
    const status = conduct.data ?? (await conduct.refetch()).data;
    if (status?.accepted) return send(input);
    setPending(input);
    setConductOpen(true);
  };

  const acceptConduct = () =>
    void run(() => housingUseCases.acceptConduct().execute(conduct.data?.version ?? 1)).then((ok) => {
      if (!ok) return;
      setConductOpen(false);
      if (pending) send(pending);
      setPending(null);
    });

  const cancel = async (target: HousingGuestStay) => {
    const late = target.status === 'confirmed' && isLateHousingCancel(target.startsAt, 'guest', new Date());
    const message = late ? t('housingStay.cancelConfirmLate') : t('housingStay.cancelConfirmMessage');
    if (!(await confirmAction(t('housingStay.cancelConfirmTitle'), message, { destructive: true }))) return;
    await run(() => housingUseCases.cancel().execute(target.handoffId, 'guest', target.status));
  };

  return (
    <View style={styles.box} testID="housing-guest-panel">
      {stay ? <StayStatus stay={stay} /> : null}
      {stay ? (
        <GuestStayActions
          stay={stay}
          busy={busy}
          onCancel={() => void cancel(stay)}
          onRate={(rating, note) => void run(() => givingHandoffUseCases.rate().execute(stay.handoffId, rating, note))}
        />
      ) : (
        <HousingStayRequestForm listingId={listingId} terms={terms} busy={busy} onSubmit={(input) => void submit(input)} />
      )}
      <HousingConductModal
        visible={conductOpen}
        busy={busy}
        onAccept={acceptConduct}
        onDismiss={() => setConductOpen(false)}
      />
    </View>
  );
}

function StayStatus({ stay }: { readonly stay: HousingGuestStay }) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const line = stay.status === 'reserved'
    ? t('housingStay.waiting', { time: stay.confirmBy ? format(new Date(stay.confirmBy), 'dd/MM HH:mm') : '' })
    : stay.status === 'confirmed' ? t('housingStay.confirmed') : t('housingStay.completed');
  return (
    <>
      <Text style={typography.h3}>{t('housingStay.guestTitle')}</Text>
      <Text style={styles.caption}>
        {t('housingStay.stayDates', { from: stay.checkInDate, to: stay.checkOutDate })}
        {' · '}
        {t(`housingStay.statusLabel.${stay.status}`)}
      </Text>
      <Text style={styles.caption} testID="housing-guest-status">{line}</Text>
    </>
  );
}

interface GuestStayActionsProps {
  readonly stay: HousingGuestStay;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onRate: (rating: number, note: string | null) => void;
}

function GuestStayActions({ stay, busy, onCancel, onRate }: GuestStayActionsProps) {
  const { t } = useTranslation();
  const actions = guestStayActions(stay, new Date());
  return (
    <>
      {actions.includes('show_address') ? <HousingAddressCard listingId={stay.listingId} /> : null}
      {actions.includes('rate') ? <HandoffRatingForm busy={busy} onSubmit={onRate} /> : null}
      {actions.includes('cancel') ? (
        <HandoffActionButton testID="housing-guest-cancel" label={t('housingStay.cancelStay')} busy={busy} secondary onPress={onCancel} />
      ) : null}
    </>
  );
}
