// "Notify me about rides on this route" for the route picked in the hub search
// (docs/spec/05_giving_worlds.md §5.3 step 4, D74; gap G48): offers or requests, optional
// weekdays and hours. The server sends the alerts under the rides urgency rule (S44).
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { RIDE_TIME_WINDOWS, type RidePlace, type RideRouteWants, type RideTimeWindow } from '@kc/domain';
import { MY_RIDE_ROUTES_QUERY_KEY, rideSavedRoutesUseCases } from '../../services/rideSavedRoutesComposition';
import { handoffErrorKey } from '../../lib/marketplaceCreateErrors';
import { hapticSuccess } from '../../lib/haptics';
import { SearchChip } from '../search/SearchChip';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const WINDOWS = Object.keys(RIDE_TIME_WINDOWS) as RideTimeWindow[];

interface Props {
  readonly origin: RidePlace;
  readonly dest: RidePlace;
}

export function RideRouteFollow({ origin, dest }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [wants, setWants] = useState<RideRouteWants>('offers');
  const [days, setDays] = useState<number[]>([]);
  const [window, setWindow] = useState<RideTimeWindow | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const save = async () => {
    setBusy(true);
    try {
      await rideSavedRoutesUseCases.save().execute({ wants, origin, dest, weekdays: days, timeWindow: window });
      hapticSuccess();
      setOpen(false);
      await qc.invalidateQueries({ queryKey: MY_RIDE_ROUTES_QUERY_KEY });
      alert(t('rideRoutes.saved'));
    } catch (err) {
      alert(t(handoffErrorKey(err) ?? 'rideRoutes.saveError'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Pressable accessibilityRole="button" testID="ride-route-follow" onPress={() => setOpen(true)}>
        <Text style={styles.link}>{t('rideRoutes.follow')}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.box} testID="ride-route-follow-form">
      <Text style={styles.label}>{t('rideRoutes.wantsLabel')}</Text>
      <View style={styles.chips}>
        {(['offers', 'requests'] as const).map((w) => (
          <SearchChip key={w} label={t(`rideRoutes.wants.${w}`)} active={wants === w} onPress={() => setWants(w)} />
        ))}
      </View>
      <Text style={styles.label}>{t('rideRoutes.daysLabel')}</Text>
      <View style={styles.chips}>
        {WEEKDAYS.map((d) => (
          <SearchChip key={d} label={t(`rideRoutes.weekday.${d}`)} active={days.includes(d)} onPress={() => toggleDay(d)} />
        ))}
      </View>
      <Text style={styles.label}>{t('rideRoutes.hoursLabel')}</Text>
      <View style={styles.chips}>
        <SearchChip label={t('rideRoutes.anyHour')} active={window === null} onPress={() => setWindow(null)} />
        {WINDOWS.map((w) => (
          <SearchChip key={w} label={t(`rideRoutes.window.${w}`)} active={window === w} onPress={() => setWindow(w)} />
        ))}
      </View>
      <Pressable accessibilityRole="button" testID="ride-route-follow-save" style={styles.btn} disabled={busy} onPress={() => void save()}>
        <Text style={styles.btnText}>{t('rideRoutes.save')}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  link: { ...typography.button, color: colors.primary, paddingVertical: spacing.xs },
  box: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  label: { ...typography.caption, color: colors.textSecondary },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  btn: { padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.primary, alignItems: 'center' as const },
  btnText: { ...typography.button, color: colors.textInverse },
}));
