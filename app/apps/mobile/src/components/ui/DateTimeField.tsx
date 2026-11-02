// A date + time field that works on every platform (gap G49):
//   • iOS — the native spinner in a bottom sheet, applied on "done", drawn in the app's theme
//     (not the phone's) so its digits stay visible on the sheet;
//   • Android — the native picker does not do date and time at once, so it opens the date
//     dialog and then the time dialog;
//   • web — the browser's `datetime-local` input in the same sheet.
// Optional shortcut chips set common values in one tap (e.g. ride departure "in 30 min").
import React, { createElement, useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale';
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

interface Props {
  /** Field label; also the picker sheet's title and the field's accessibility label. */
  readonly label: string;
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

export function DateTimeField({ label, value, onChange, placeholder, minimumDate, shortcuts, disabled, testID }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const { colors, isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(value ?? minimumDate ?? new Date());

  const openPicker = () => {
    const start = value ?? minimumDate ?? new Date();
    if (Platform.OS === 'android') {
      openAndroidPicker(start, minimumDate, onChange);
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
          {value ? format(value, 'EEEE, d MMMM · HH:mm', { locale: dateFnsHe }) : (placeholder ?? label)}
        </Text>
        <Ionicons name="calendar-outline" size={iconSize.xl} color={colors.primary} />
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
                type: 'datetime-local',
                value: toWebLocalValue(draft),
                min: minimumDate ? toWebLocalValue(minimumDate) : undefined,
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
                  const next = fromWebLocalValue(e.target.value);
                  if (next) setDraft(next);
                },
              })
            ) : (
              <DateTimePicker
                value={draft}
                mode="datetime"
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

/** Android: the date dialog, then the time dialog on the chosen day; dismissing either cancels. */
function openAndroidPicker(start: Date, minimumDate: Date | undefined, onChange: (next: Date) => void) {
  DateTimePickerAndroid.open({
    value: start,
    mode: 'date',
    minimumDate,
    onChange: (dateEvent, day) => {
      if (dateEvent.type !== 'set' || !day) return;
      DateTimePickerAndroid.open({
        value: day,
        mode: 'time',
        is24Hour: true,
        onChange: (timeEvent, time) => {
          if (timeEvent.type === 'set' && time) onChange(time);
        },
      });
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
