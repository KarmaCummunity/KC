// Slot editor of a knowledge lesson offer or consulting hour (FR-KNOW-004 AC1, #2034): one row per
// bookable time — a start and a length — plus "add a time" up to the kind's limit. The value is the
// post's `details.slots` (`[{starts_at, ends_at}]`); the server matches slots to bookings by start
// and refuses to drop or move a booked one, so editing a booked slot surfaces that error on save.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { knowledgeSlotsFromDetails, knowledgeSlotsToDetails, type KnowledgeSlotWindow } from '@kc/domain';
import { DateTimeField } from '../ui/DateTimeField';
import { Chip } from '../ui/Chip';
import { ChipSelectRow } from '../filterKit/ChipSelectRow';

/** Session lengths offered, in minutes (the server accepts 15 minutes to 8 hours). */
export const KNOWLEDGE_SLOT_LENGTHS_MIN = [30, 45, 60, 90, 120] as const;
const DEFAULT_LENGTH_MIN = 60;
const MINUTE_MS = 60_000;

type SlotDetails = Array<{ starts_at: string; ends_at: string }>;

interface Props {
  readonly value: unknown;
  readonly onChange: (next: SlotDetails) => void;
  readonly maxSlots: number;
  readonly disabled?: boolean;
}

const useStyles = makeUseStyles(({ colors }) => ({
  list: { gap: spacing.md },
  slot: { gap: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  link: { ...typography.button, color: colors.primary, paddingVertical: spacing.xs },
  remove: { ...typography.caption, color: colors.error, paddingVertical: spacing.xs },
}));

/** A slot of `minutes` starting at `start`. */
function windowAt(start: Date, minutes: number): KnowledgeSlotWindow {
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + minutes * MINUTE_MS).toISOString() };
}

/** Length of a slot in whole minutes, or null when its times are unreadable. */
function lengthOf(slot: KnowledgeSlotWindow): number | null {
  const minutes = (Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / MINUTE_MS;
  return Number.isFinite(minutes) ? Math.round(minutes) : null;
}

/**
 * Where a new slot starts: a week after the latest one (a weekly lesson is the common case),
 * or tomorrow at 18:00 for the first.
 */
export function nextSlotStart(slots: readonly KnowledgeSlotWindow[], now: Date = new Date()): Date {
  const latest = slots.map((s) => Date.parse(s.startsAt)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (latest !== undefined) return new Date(latest + 7 * 24 * 60 * MINUTE_MS);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);
  return tomorrow;
}

export function KnowledgeSlotListField({ value, onChange, maxSlots, disabled = false }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const slots = knowledgeSlotsFromDetails({ slots: value }) ?? [];
  const emit = (next: readonly KnowledgeSlotWindow[]) => onChange(knowledgeSlotsToDetails(next));
  const replaceAt = (index: number, next: KnowledgeSlotWindow) => emit(slots.map((s, i) => (i === index ? next : s)));

  return (
    <View style={styles.list} testID="knowledge-slot-list">
      {slots.map((slot, index) => (
        <View key={`${slot.startsAt}-${index}`} style={styles.slot} testID={`knowledge-slot-${index}`}>
          <DateTimeField
            testID={`knowledge-slot-start-${index}`}
            label={t('knowledgeBooking.slotStart', { n: index + 1 })}
            value={Number.isNaN(Date.parse(slot.startsAt)) ? null : new Date(slot.startsAt)}
            onChange={(d) => replaceAt(index, windowAt(d, lengthOf(slot) ?? DEFAULT_LENGTH_MIN))}
            minimumDate={new Date()}
            disabled={disabled}
          />
          <ChipSelectRow testID={`knowledge-slot-length-${index}`}>
            {KNOWLEDGE_SLOT_LENGTHS_MIN.map((minutes) => (
              <Chip
                key={minutes}
                label={t('knowledgeBooking.slotLength', { minutes })}
                selected={lengthOf(slot) === minutes}
                onPress={() => replaceAt(index, windowAt(new Date(slot.startsAt), minutes))}
                disabled={disabled}
              />
            ))}
          </ChipSelectRow>
          <Pressable
            accessibilityRole="button"
            testID={`knowledge-slot-remove-${index}`}
            disabled={disabled}
            onPress={() => emit(slots.filter((_, i) => i !== index))}
          >
            <Text style={styles.remove}>{t('knowledgeBooking.removeSlot')}</Text>
          </Pressable>
        </View>
      ))}
      {slots.length < maxSlots ? (
        <Pressable
          accessibilityRole="button"
          testID="knowledge-slot-add"
          disabled={disabled}
          onPress={() => emit([...slots, windowAt(nextSlotStart(slots), DEFAULT_LENGTH_MIN)])}
        >
          <Text style={styles.link}>{t('knowledgeBooking.addSlot')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
