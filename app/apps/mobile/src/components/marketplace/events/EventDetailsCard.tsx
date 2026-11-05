// Mapped to spec: docs/spec/08_organizations.md Events (G1 step 5, D31) — what an organization's
// event post shows everyone: its date window, address, capacity and registration policy.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text, typography } from '@kc/ui';
import { parseEventPostDetails } from '@kc/domain';
import { formatRideTime } from '../../cards/ListingCard';
import { useEventSectionStyles } from './eventSectionStyles';

interface Props {
  /** The event listing's details (`starts_at`, `ends_at`, `registration_policy`…). */
  readonly details: Readonly<Record<string, unknown>>;
}

export function EventDetailsCard({ details }: Props) {
  const { t } = useTranslation();
  const styles = useEventSectionStyles();
  const event = parseEventPostDetails(details);
  if (!event) return null;

  return (
    <View style={styles.box} testID="event-section">
      <Text style={typography.h3}>{t('eventPost.section.title')}</Text>
      <Text style={styles.line} testID="event-starts">
        {t('eventPost.section.startsAt', { time: formatRideTime(event.startsAt) ?? '' })}
      </Text>
      <Text style={styles.line}>{t('eventPost.section.endsAt', { time: formatRideTime(event.endsAt) ?? '' })}</Text>
      {event.address ? <Text style={styles.line}>{t('eventPost.section.address', { address: event.address })}</Text> : null}
      {event.capacity !== null ? (
        <Text style={styles.line}>{t('eventPost.section.capacity', { count: event.capacity })}</Text>
      ) : null}
      <Text style={styles.caption} testID="event-policy">
        {t('eventPost.section.policy', { policy: t(`marketplace.option.${event.registrationPolicy}`) })}
      </Text>
    </View>
  );
}
