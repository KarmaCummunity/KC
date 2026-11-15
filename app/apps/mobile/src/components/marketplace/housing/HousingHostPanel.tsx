// The host's side of a stay offer (FR-HOUSING-016, 018–021, 036): every live booking with its
// actions. A host cancelling a confirmed stay tells the guest why (FR-HOUSING-018 AC3), so the
// cancel opens a short reason dialog; a no-show is confirmed first, since it cannot be undone.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Text, typography } from '@kc/ui';
import type { HousingHostBooking } from '@kc/domain';
import { useAuthStore } from '../../../store/authStore';
import { housingQueryKeys, housingUseCases, openHousingChat } from '../../../services/housingComposition';
import { givingHandoffUseCases } from '../../../services/givingHandoffComposition';
import { confirmAction } from '../../../services/platformConfirm';
import { Modal } from '../../ui/Modal';
import { DangerButton } from '../../ui/Buttons';
import { TextField } from '../../ui/TextField';
import { useRideBookingStyles } from '../rides/rideBookingStyles';
import { HousingHostBookingRow, type HousingHostRowActions } from './HousingHostBookingRow';
import { HousingHostPrivateDetailsEditor } from './HousingHostPrivateDetailsEditor';
import { useHousingAction } from './useHousingAction';
import { OwnerAssignUserButton } from '../../closure/OwnerAssignUserButton';
import { listOrEmpty } from '../../../lib/backendAvailability';

interface Props {
  readonly listingId: string;
  readonly cityId: string | null;
  /** The offer's listing status; a guest is assigned only while it is open. */
  readonly listingStatus: string;
  readonly hideOwnerAssign?: boolean;
}

export function HousingHostPanel({ listingId, cityId, listingStatus, hideOwnerAssign = false }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useRideBookingStyles();
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const { busy, run } = useHousingAction(listingId);
  const [cancelTarget, setCancelTarget] = useState<HousingHostBooking | null>(null);
  const [reason, setReason] = useState('');
  const bookings = useQuery({
    queryKey: housingQueryKeys.offerBookings(listingId),
    queryFn: () => listOrEmpty(() => housingUseCases.listForOffer().execute(listingId)),
  });
  const list = bookings.data ?? [];

  const markNoShow = async (booking: HousingHostBooking) => {
    if (!(await confirmAction(t('housingStay.noShowConfirmTitle'), t('housingStay.noShowConfirmMessage'), { destructive: true }))) return;
    await run(() => housingUseCases.markNoShow().execute(booking));
  };

  const confirmCancel = () => {
    const target = cancelTarget;
    if (!target) return;
    void run(() => housingUseCases.cancel().execute(target.handoffId, 'host', target.status, reason)).then((ok) => {
      if (ok) setCancelTarget(null);
    });
  };

  const actions: HousingHostRowActions = {
    approve: (b) => void run(() => housingUseCases.decide().execute(b, true)),
    decline: (b) => void run(() => housingUseCases.decide().execute(b, false)),
    // A waiting request is withdrawn without a reason; a confirmed stay needs one.
    cancel: (b) => {
      setReason('');
      setCancelTarget(b);
    },
    complete: (b) => void run(() => housingUseCases.complete().execute(b)),
    noShow: (b) => void markNoShow(b),
    rate: (b, rating, note) => void run(() => givingHandoffUseCases.rate().execute(b.handoffId, rating, note)),
    chat: (b) => {
      if (!viewerId) return;
      void openHousingChat(viewerId, b.guestId)
        .then((chatId) => router.push(`/chat/${chatId}`))
        .catch(() => alert(t('givingHandoff.errorGeneric')));
    },
  };

  return (
    <View style={styles.box} testID="housing-host-panel">
      <Text style={typography.h3}>{t('housingStay.hostTitle')}</Text>
      {bookings.isError ? (
        <Pressable accessibilityRole="button" onPress={() => void bookings.refetch()} testID="housing-bookings-retry">
          <Text style={styles.caption}>{t('housingStay.loadError')}</Text>
        </Pressable>
      ) : null}
      {bookings.isSuccess && list.length === 0 ? (
        <Text style={styles.caption} testID="housing-bookings-empty">{t('housingStay.empty')}</Text>
      ) : null}
      {/* `owner_complete_offer_with_user` refuses an offer that is not open (0658). */}
      {listingStatus === 'open' && !hideOwnerAssign ? (
        <OwnerAssignUserButton targetId={listingId} worldSlug="housing" />
      ) : null}
      {list.map((booking) => (
        <HousingHostBookingRow key={booking.handoffId} booking={booking} busy={busy} actions={actions} />
      ))}
      <HousingHostPrivateDetailsEditor listingId={listingId} cityId={cityId} />
      <Modal
        visible={cancelTarget !== null}
        onDismiss={() => setCancelTarget(null)}
        title={t('housingStay.hostCancel')}
        footer={<DangerButton testID="housing-host-cancel-confirm" label={t('housingStay.hostCancel')} loading={busy} onPress={confirmCancel} />}
      >
        <TextField
          testID="housing-host-cancel-reason"
          label={t('housingStay.hostCancelReason')}
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={300}
        />
      </Modal>
    </View>
  );
}
