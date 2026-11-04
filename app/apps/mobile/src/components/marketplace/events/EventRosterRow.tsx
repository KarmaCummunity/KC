// One registration in the organizer's roster: who, its state (or waitlist place), and the actions
// that state allows — deciding and removing before the start, attendance from the start (0564).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import type { EventRegistration } from '@kc/domain';
import { rosterActionsFor, type EventRosterAction } from '../../../lib/eventPost';
import { HandoffActionButton } from '../HandoffActionButton';
import { useEventSectionStyles } from './eventSectionStyles';

interface Props {
  readonly registration: EventRegistration;
  /** The event has started: confirmed registrants are marked attended or absent. */
  readonly started: boolean;
  /** 1-based place on the waitlist, for a waitlisted registration. */
  readonly waitlistPosition?: number;
  /** An action of the roster is running. */
  readonly busy: boolean;
  readonly onAction: (action: EventRosterAction) => void;
}

/** The main choice of each pair; the others are its outlined alternatives. */
const MAIN_ACTIONS: ReadonlySet<EventRosterAction> = new Set(['approve', 'attended']);

export function EventRosterRow({ registration, started, waitlistPosition, busy, onAction }: Props) {
  const { t } = useTranslation();
  const styles = useEventSectionStyles();
  const id = registration.handoffId;
  const actions = rosterActionsFor(registration.status, started);
  const stateLabel = waitlistPosition
    ? t('eventPost.roster.waitlistPosition', { position: waitlistPosition })
    : t(`eventPost.roster.statusLabel.${registration.status}`);

  return (
    <View style={styles.row} testID={`event-roster-row-${id}`}>
      <Text style={styles.name}>{registration.displayName || t('eventPost.roster.nameFallback')}</Text>
      <Text style={styles.caption} testID={`event-roster-status-${id}`}>{stateLabel}</Text>
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <HandoffActionButton
              key={action}
              inRow
              secondary={!MAIN_ACTIONS.has(action)}
              testID={`event-roster-${action}-${id}`}
              label={t(`eventPost.roster.${action}`)}
              busy={busy}
              onPress={() => onAction(action)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
