// "Recurring event" in the event form (FR-POST-024): a switch, then the weekdays and an optional
// end date. The start and end fields above give the time of day and the length; the server
// publishes one event per picked day for the coming month, each with its own registrations.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { localTimeHHmm } from '@kc/domain';
import { RideRecurrenceFields, type RideRecurrenceDraft } from '../giving/RideRecurrenceFields';

interface Props {
  /** Null while the event is a single one. */
  readonly value: RideRecurrenceDraft | null;
  readonly onChange: (next: RideRecurrenceDraft | null) => void;
  /** The form's details; `starts_at` gives the series its time of day and first weekday. */
  readonly details: Readonly<Record<string, unknown>>;
  readonly disabled?: boolean;
}

/** The event's start as a date; null until the member picked one. */
function startOf(details: Readonly<Record<string, unknown>>): Date | null {
  const startsAt = details.starts_at;
  const at = Date.parse(typeof startsAt === 'string' ? startsAt : '');
  return Number.isNaN(at) ? null : new Date(at);
}

export function EventRecurrenceSection({ value, onChange, details, disabled }: Props) {
  const { t } = useTranslation();
  const startsAt = startOf(details);
  return (
    <RideRecurrenceFields
      testID="event-recurrence"
      value={value}
      onChange={onChange}
      departsAt={startsAt}
      disabled={disabled}
      toggleLabel={t('postSeries.toggle')}
      hint={startsAt ? t('postSeries.publishHint', { time: localTimeHHmm(startsAt) }) : t('postSeries.startHint')}
    />
  );
}
