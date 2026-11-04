// One registration in the organizer's roster: who, its state, and the actions that state allows.
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
  /** An action of the roster is running. */
  readonly busy: boolean;
  readonly onAction: (action: EventRosterAction) => void;
}

export function EventRosterRow({ registration, busy, onAction }: Props) {
  const { t } = useTranslation();
  const styles = useEventSectionStyles();
  const id = registration.handoffId;
  const actions = rosterActionsFor(registration.status);

  return (
    <View style={styles.row} testID={`event-roster-row-${id}`}>
      <Text style={styles.name}>{registration.displayName || t('eventPost.roster.nameFallback')}</Text>
      <Text style={styles.caption}>
        {t(`eventPost.roster.statusLabel.${registration.status}`, { defaultValue: registration.status })}
      </Text>
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <HandoffActionButton
              key={action}
              inRow
              // Approving is the main choice; declining and removing are the outlined alternatives.
              secondary={action !== 'approve'}
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
