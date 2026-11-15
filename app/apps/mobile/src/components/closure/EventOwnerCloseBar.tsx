// G18, D124 / D128 / D131 — the organizer's close of an organization's event. An event is not
// "delivered" to anyone: it ends. Before the start, ending it cancels every registration and
// notifies each attendee (0686); after the start the registrations stay, so the organizer can
// still mark attendance, which alone earns karma (0735). The item close flow (pick who received
// it, assign a user) does not apply.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { PrimaryButton } from '../ui/Buttons';
import { ConfirmActionModal } from '../post/ConfirmActionModal';
import { listingOwnerErrorKey } from '../../lib/listingOwnerError';
import { marketplaceRepository } from '../../services/marketplaceComposition';
import { useFeedSessionStore } from '../../store/feedSessionStore';

export interface EventOwnerCloseBarProps {
  readonly listingId: string;
  /** The event's start (ISO); before it, ending the event cancels its registrations. */
  readonly startsAt: string;
}

export function EventOwnerCloseBar({ listingId, startsAt }: EventOwnerCloseBarProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const styles = useStyles();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const started = new Date(startsAt).getTime() <= Date.now();

  const end = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      await marketplaceRepository().fulfillMyListing(listingId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['marketplace-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['feed'] }),
        queryClient.invalidateQueries({ queryKey: ['event-registration'] }),
      ]);
      setConfirming(false);
      useFeedSessionStore.getState().showEphemeralToast(t('eventPost.ownerClose.done'), 'success', 2200);
      if (router.canGoBack()) router.back();
    } catch (error) {
      setErrorKey(listingOwnerErrorKey(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.bar} testID="event-owner-close">
      <PrimaryButton
        testID="event-owner-close-open"
        label={t('eventPost.ownerClose.cta')}
        icon="flag-outline"
        fullWidth
        onPress={() => { setErrorKey(null); setConfirming(true); }}
      />
      <ConfirmActionModal
        visible={confirming}
        title={t('eventPost.ownerClose.confirmTitle')}
        message={t(started ? 'eventPost.ownerClose.afterStart' : 'eventPost.ownerClose.beforeStart')}
        confirmLabel={t('eventPost.ownerClose.confirm')}
        destructive={!started}
        isBusy={busy}
        errorMessage={errorKey ? t(errorKey) : null}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void end()}
      />
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  bar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
}));
