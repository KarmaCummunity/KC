// The organizer's view of an event's registrations: counts, then every registration with the
// actions its state allows — approve or decline a waiting one, remove a confirmed one (G1 step 5).
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Text, typography } from '@kc/ui';
import { summarizeEventRoster, type EventRosterAction } from '../../../lib/eventPost';
import { eventRegistrationUseCases, eventRosterQueryKey } from '../../../services/eventRegistrationComposition';
import { EventRosterRow } from './EventRosterRow';
import { useEventRegistrationAction } from './useEventRegistrationAction';
import { useEventSectionStyles } from './eventSectionStyles';

interface Props {
  readonly postId: string;
}

/** The use case call behind each organizer action on one registration. */
function rosterActionCall(action: EventRosterAction, handoffId: string): Promise<void> {
  if (action === 'remove') return eventRegistrationUseCases.cancel().execute(handoffId);
  return eventRegistrationUseCases.decide().execute(handoffId, action === 'approve');
}

export function EventRosterPanel({ postId }: Props) {
  const { t } = useTranslation();
  const styles = useEventSectionStyles();
  const { busy, run } = useEventRegistrationAction(postId);
  const roster = useQuery({
    queryKey: eventRosterQueryKey(postId),
    queryFn: () => eventRegistrationUseCases.listForEvent().execute(postId),
  });
  const list = roster.data ?? [];

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
      {list.map((registration) => (
        <EventRosterRow
          key={registration.handoffId}
          registration={registration}
          busy={busy}
          onAction={(action) => void run(`event_${action}`, () => rosterActionCall(action, registration.handoffId))}
        />
      ))}
    </View>
  );
}
