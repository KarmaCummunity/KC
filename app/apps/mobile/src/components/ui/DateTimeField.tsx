// A date + time field that works on every platform (gap G49):
//   • iOS — the native spinner in a bottom sheet, applied on "done", drawn in the app's theme
//     (not the phone's) so its digits stay visible on the sheet;
//   • Android — the native picker does not do date and time at once, so it opens the date
//     dialog and then the time dialog;
//   • web — the browser's `datetime-local` input in the same sheet.
// Optional shortcut chips set common values in one tap (e.g. ride departure "in 30 min").
// `mode` narrows the field to a date or a time alone (recurring rides, FR-RIDE-046).
import React, { createElement, useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale/he';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { SearchChip } from '../search/SearchChip';

export interface DateTimeShortcut {
  readonly key: string;
  readonly label: string;
  /** The value the shortcut sets, computed at tap time. */
  readonly at: () => Date;
}

/** What the field picks: a moment (default), a day, or a time of day. */
export type DateTimeFieldMode = 'datetime' | 'date' | 'time';

/** How a picked value reads in the field, per mode. */
const DISPLAY_FORMAT: Record<DateTimeFieldMode, string> = {
  datetime: 'EEEE, d MMMM · HH:mm',
  date: 'EEEE, d MMMM',
  time: 'HH:mm',
};

/** The browser input type per mode. */
const WEB_INPUT_TYPE: Record<DateTimeFieldMode, string> = { datetime: 'datetime-local', date: 'date', time: 'time' };

interface Props {
  /** Field label; also the picker sheet's title and the field's accessibility label. */
  readonly label: string;
  readonly mode?: DateTimeFieldMode;
  /** Null shows the placeholder until a value is picked. */
  readonly value: Date | null;
  readonly onChange: (next: Date) => void;
  readonly placeholder?: string;
  readonly minimumDate?: Date;
  readonly shortcuts?: readonly DateTimeShortcut[];
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** `yyyy-MM-ddTHH:mm` in local time, the value format of `<input type="datetime-local">`. */
export function toWebLocalValue(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

/** A `datetime-local` value as a Date, or null when the browser sent an empty or broken value. */
export function fromWebLocalValue(value: string): Date | null {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

/** The browser input's value for a date, per mode (`yyyy-MM-dd`, `HH:mm` or the local datetime). */
export function toWebInputValue(d: Date, mode: DateTimeFieldMode): string {
  if (mode === 'date') return format(d, 'yyyy-MM-dd');
  if (mode === 'time') return format(d, 'HH:mm');
  return toWebLocalValue(d);
}

/**
 * A browser input's value as a Date, per mode. A day is read at midnight; a time keeps the day of
 * `base`. Null for an empty or broken value.
 */
export function fromWebInputValue(value: string, mode: DateTimeFieldMode, base: Date): Date | null {
  if (mode === 'date') return fromWebLocalValue(value ? `${value}T00:00` : '');
  if (mode === 'time') return fromWebLocalValue(value ? `${format(base, 'yyyy-MM-dd')}T${value}` : '');
  return fromWebLocalValue(value);
}

export function DateTimeField({ label, mode = 'datetime', value, onChange, placeholder, minimumDate, shortcuts, disabled, testID }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const { colors, isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(value ?? minimumDate ?? new Date());

  const openPicker = () => {
    const start = value ?? minimumDate ?? new Date();
    if (Platform.OS === 'android') {
      openAndroidPicker(start, minimumDate, onChange, mode);
      return;
    }
    setDraft(start);
    setOpen(true);
  };

  const apply = () => {
    onChange(draft);
    setOpen(false);
  };

  return (
    <View testID={testID}>
      <Pressable
        style={styles.field}
        onPress={openPicker}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[styles.value, value ? null : styles.placeholder]}>
          {value ? format(value, DISPLAY_FORMAT[mode], { locale: dateFnsHe }) : (placeholder ?? label)}
        </Text>
        <Ionicons name={mode === 'time' ? 'time-outline' : 'calendar-outline'} size={iconSize.xl} color={colors.primary} />
      </Pressable>

      {shortcuts && shortcuts.length > 0 ? (
        <View style={styles.shortcuts}>
          {shortcuts.map((s) => (
            <SearchChip key={s.key} label={s.label} active={false} onPress={() => onChange(s.at())} />
          ))}
        </View>
      ) : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>{label}</Text>
            {Platform.OS === 'web' ? (
              createElement('input', {
                type: WEB_INPUT_TYPE[mode],
                value: toWebInputValue(draft, mode),
                min: minimumDate ? toWebInputValue(minimumDate, mode) : undefined,
                dir: 'ltr',
                style: {
                  ...typography.bodyLarge,
                  width: '100%',
                  padding: spacing.md,
                  border: `1px solid ${colors.border}`,
                  borderRadius: radius.md,
                  color: colors.textPrimary,
                  backgroundColor: colors.surface,
                },
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  const next = fromWebInputValue(e.target.value, mode, draft);
                  if (next) setDraft(next);
                },
              })
            ) : (
              <DateTimePicker
                value={draft}
                mode={mode}
                display="spinner"
                minimumDate={minimumDate}
                locale="he-IL"
                // The spinner follows the phone's appearance unless told otherwise, while the sheet
                // follows the app's theme (light by default). On a phone in dark mode it drew white
                // digits on the light sheet, so the picker looked empty (#1398).
                themeVariant={isDark ? 'dark' : 'light'}
                textColor={colors.textPrimary}
                onChange={(_e: DateTimePickerEvent, d?: Date) => d && setDraft(d)}
              />
            )}
            <View style={styles.actions}>
              <Pressable style={styles.actionBtn} onPress={() => setOpen(false)} accessibilityRole="button">
                <Text style={styles.actionText}>{t('dateTimeField.cancel')}</Text>
              </Pressable>
              <Pressable style={styles.actionBtn} onPress={apply} accessibilityRole="button" testID={testID ? `${testID}-done` : undefined}>
                <Text style={styles.actionText}>{t('dateTimeField.done')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * Android's time dialog returns a Date whose calendar day is "today", not the day
 * the user already picked. Keep that day and take only the clock.
 */
export function applyAndroidClock(day: Date, clock: Date): Date {
  const next = new Date(day);
  next.setHours(clock.getHours(), clock.getMinutes(), 0, 0);
  return next;
}

/** Android: the time dialog on a given day; dismissing it cancels. */
function openAndroidTimePicker(day: Date, onChange: (next: Date) => void) {
  DateTimePickerAndroid.open({
    value: day,
    mode: 'time',
    is24Hour: true,
    onChange: (timeEvent, time) => {
      if (timeEvent.type === 'set' && time) onChange(applyAndroidClock(day, time));
    },
  });
}

/**
 * Android has no combined picker: a moment is the date dialog, then the time dialog on the chosen
 * day; a day or a time alone is its one dialog. Dismissing any dialog cancels.
 */
function openAndroidPicker(start: Date, minimumDate: Date | undefined, onChange: (next: Date) => void, mode: DateTimeFieldMode) {
  if (mode === 'time') {
    openAndroidTimePicker(start, onChange);
    return;
  }
  DateTimePickerAndroid.open({
    value: start,
    mode: 'date',
    minimumDate,
    onChange: (dateEvent, day) => {
      if (dateEvent.type !== 'set' || !day) return;
      if (mode === 'date') onChange(day);
      else openAndroidTimePicker(day, onChange);
    },
  });
}

const useStyles = makeUseStyles(({ colors }) => ({
  field: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  value: { flex: 1, ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  placeholder: { color: colors.textSecondary },
  shortcuts: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm, marginTop: spacing.sm },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' as const },
  sheet: {
    backgroundColor: colors.surface,
    borderTopStartRadius: radius.xl,
    borderTopEndRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: spacing.md },
  actionBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  actionText: { ...typography.button, color: colors.primary },
}));
