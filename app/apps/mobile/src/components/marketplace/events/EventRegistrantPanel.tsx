// A member's registration to an organization's event: register (or ask to join a manual event),
// then follow it — waiting for the organizer, confirmed, or on the waitlist of a full event — and
// cancel it or leave the waitlist (G1 step 5, D31, 0564).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Text } from '@kc/ui';
import { canLeaveEventRegistration, type EventPostDetails } from '@kc/domain';
import { eventHasStarted, registerActionLabelKey } from '../../../lib/eventPost';
import { eventRegistrationUseCases, myEventRegistrationQueryKey } from '../../../services/eventRegistrationComposition';
import { HandoffActionButton } from '../HandoffActionButton';
import { useEventRegistrationAction } from './useEventRegistrationAction';
import { useEventSectionStyles } from './eventSectionStyles';

interface Props {
  readonly postId: string;
  readonly event: EventPostDetails;
}

export function EventRegistrantPanel({ postId, event }: Props) {
  const { t } = useTranslation();
  const styles = useEventSectionStyles();
  const { busy, run } = useEventRegistrationAction(postId);
  const mine = useQuery({
    queryKey: myEventRegistrationQueryKey(postId),
    queryFn: () => eventRegistrationUseCases.getMine().execute(postId),
  });
  if (!mine.isSuccess) return null;

  const registration = mine.data;
  const register = () => run('event_register', () => eventRegistrationUseCases.register().execute(postId));
  return (
    <View style={styles.box} testID="event-registration">
      {registration?.status === 'reserved' ? (
        <Text style={styles.caption} testID="event-status-pending">{t('eventPost.registration.statusReserved')}</Text>
      ) : null}
      {registration?.status === 'confirmed' ? (
        <Text style={styles.caption} testID="event-status-confirmed">{t('eventPost.registration.statusConfirmed')}</Text>
      ) : null}
      {registration?.status === 'waitlisted' ? (
        <Text style={styles.caption} testID="event-status-waitlisted">{t('eventPost.registration.statusWaitlisted')}</Text>
      ) : null}
      {registration && canLeaveEventRegistration(registration.status) ? (
        <HandoffActionButton
          testID="event-cancel"
          label={t(registration.status === 'waitlisted' ? 'eventPost.registration.leaveWaitlist' : 'eventPost.registration.cancel')}
          busy={busy}
          secondary
          onPress={() => void run('event_cancel', () => eventRegistrationUseCases.cancel().execute(registration.handoffId))}
        />
      ) : null}
      {!registration && eventHasStarted(event.startsAt) ? (
        <Text style={styles.caption} testID="event-started">{t('eventPost.registration.started')}</Text>
      ) : null}
      {!registration && !eventHasStarted(event.startsAt) ? (
        <HandoffActionButton
          testID="event-register"
          label={t(registerActionLabelKey(event.registrationPolicy))}
          busy={busy}
          onPress={() => void register()}
        />
      ) : null}
    </View>
  );
}
