// The organizer's view of an event's registrations: counts, the registrations with the actions
// their state allows (approve / decline a request, remove a place, mark attendance from the
// start), then the waitlist in promotion order, earliest first (G1 step 5, 0564).
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Text, typography } from '@kc/ui';
import type { EventRegistration } from '@kc/domain';
import { eventHasStarted, groupEventRoster, summarizeEventRoster, type EventRosterAction } from '../../../lib/eventPost';
import { eventRegistrationUseCases, eventRosterQueryKey } from '../../../services/eventRegistrationComposition';
import { EventRosterRow } from './EventRosterRow';
import { useEventRegistrationAction } from './useEventRegistrationAction';
import { useEventSectionStyles } from './eventSectionStyles';

interface Props {
  readonly postId: string;
  /** The event's start: attendance is marked from it on. */
  readonly startsAt: string;
}

/** The use case call behind each organizer action on one registration. */
function rosterActionCall(action: EventRosterAction, handoffId: string): Promise<void> {
  if (action === 'remove') return eventRegistrationUseCases.cancel().execute(handoffId);
  if (action === 'attended' || action === 'noshow') {
    return eventRegistrationUseCases.markAttendance().execute(handoffId, action === 'attended');
  }
  return eventRegistrationUseCases.decide().execute(handoffId, action === 'approve');
}

export function EventRosterPanel({ postId, startsAt }: Props) {
  const { t } = useTranslation();
  const styles = useEventSectionStyles();
  const { busy, run } = useEventRegistrationAction(postId);
  const roster = useQuery({
    queryKey: eventRosterQueryKey(postId),
    queryFn: () => eventRegistrationUseCases.listForEvent().execute(postId),
  });
  const list = roster.data ?? [];
  const { registrations, waitlist } = groupEventRoster(list);
  const started = eventHasStarted(startsAt);

  const row = (registration: EventRegistration, waitlistPosition?: number) => (
    <EventRosterRow
      key={registration.handoffId}
      registration={registration}
      started={started}
      waitlistPosition={waitlistPosition}
      busy={busy}
      onAction={(action) => void run(`event_${action}`, () => rosterActionCall(action, registration.handoffId))}
    />
  );

  return (
    <View style={styles.box} testID="event-roster">
      <Text style={typography.h3}>{t('eventPost.roster.title')}</Text>
      <Text style={styles.caption} testID="event-roster-summary">
        {t('eventPost.roster.summary', summarizeEventRoster(list))}
      </Text>
      {roster.isError ? (
        <Pressable accessibilityRole="button" onPress={() => void roster.refetch()} testID="event-roster-retry">
          <Text style={styles.caption}>{t('eventPost.roster.loadError')}</Text>
        </Pressable>
      ) : null}
      {roster.isSuccess && list.length === 0 ? (
        <Text style={styles.caption} testID="event-roster-empty">{t('eventPost.roster.empty')}</Text>
      ) : null}
      {registrations.map((registration) => row(registration))}
      {waitlist.length > 0 ? (
        <View testID="event-roster-waitlist">
          <Text style={styles.name}>{t('eventPost.roster.waitlistTitle')}</Text>
          {waitlist.map((registration, index) => row(registration, index + 1))}
        </View>
      ) : null}
    </View>
  );
}
