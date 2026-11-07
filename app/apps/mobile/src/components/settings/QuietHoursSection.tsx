// Quiet hours (0256 notification_preferences.quietHours): toggle + start/end times.
// Times are committed on blur after normalising to HH:MM, so partial typing never
// reaches the server (the server casts them to `time`).
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { TextField } from '../ui/TextField';
import type { NotificationPreferences } from '@kc/domain';
import { NotificationToggleRow } from '../NotificationToggleRow';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';
import { normalizeQuietTime } from '../../lib/feedMuteFilters';
import { hapticLightTap } from '../../lib/haptics';
import { DEFAULT_QUIET_HOURS } from '../../hooks/useNotificationPreferences';

type QuietHours = NonNullable<NotificationPreferences['quietHours']>;

interface Props {
  value: NotificationPreferences['quietHours'];
  onChange: (next: QuietHours) => void;
  /** When the parent screen already shows the section title (e.g. feed settings card). */
  hideSectionTitle?: boolean;
}

function TimeField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(value), [value]);

  const commit = () => {
    const next = normalizeQuietTime(text);
    if (!next) {
      setInvalid(true);
      setText(value);
      return;
    }
    setInvalid(false);
    setText(next);
    if (next !== value) onCommit(next);
  };

  return (
    <View>
      <View style={styles.row}>
        <TextField
          containerStyle={styles.timeField}
          label={label}
          errorText={invalid ? t('feedSettings.quietTimeInvalid') : undefined}
          value={text}
          onChangeText={setText}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          placeholder="22:00"
          accessibilityLabel={label}
        />
      </View>
    </View>
  );
}

export function QuietHoursSection({ value, onChange, hideSectionTitle }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const qh: QuietHours = value ?? DEFAULT_QUIET_HOURS;
  return (
    <View>
      {hideSectionTitle ? null : <Text style={styles.header}>{t('notifications.quietHoursSection')}</Text>}
      <NotificationToggleRow
        label={t('notifications.quietHoursEnabled')}
        caption={t('notifications.quietHoursCaption')}
        value={qh.enabled}
        onValueChange={(enabled) => {
          hapticLightTap();
          onChange({ ...qh, enabled });
        }}
      />
      {qh.enabled ? (
        <>
          <TimeField
            label={t('notifications.quietHoursStart')}
            value={qh.start}
            onCommit={(start) => onChange({ ...qh, start })}
          />
          <TimeField
            label={t('notifications.quietHoursEnd')}
            value={qh.end}
            onCommit={(end) => onChange({ ...qh, end })}
          />
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  header: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    textAlign: rtlTextAlignStart,
    width: '100%',
    ...webTextRtl,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    ...webViewRtl,
  },
  timeField: { flex: 1, minWidth: 88 },
}));
