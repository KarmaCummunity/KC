// The ride's places in driving order — origin, meeting points, destination — each with
// "navigate" to Waze / Google Maps / Apple Maps (docs/spec/05_giving_worlds.md §5.3 steps 2 and 5,
// D71, D72; gap G46). Navigation links are universal: the app opens when installed, else the web.
import React, { useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { rideNavigationAppsFor, rideNavigationUrl, type RidePlace, type RideRoute } from '@kc/domain';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface Stop {
  readonly place: RidePlace;
  readonly role: 'origin' | 'meeting' | 'dest';
}

/** Origin, then meeting points, then destination; ends that are missing are skipped. */
export function routeStops(route: RideRoute): Stop[] {
  return [
    ...(route.origin ? [{ place: route.origin, role: 'origin' as const }] : []),
    ...route.meetingPoints.map((place) => ({ place, role: 'meeting' as const })),
    ...(route.dest ? [{ place: route.dest, role: 'dest' as const }] : []),
  ];
}

const ROLE_LABEL = { origin: 'cards.from', meeting: 'ridePlaces.meetingPoint', dest: 'cards.to' } as const;
const ROLE_ICON = { origin: 'radio-button-on', meeting: 'ellipse', dest: 'location' } as const;

export function RideRouteStops({ route }: Readonly<{ route: RideRoute }>) {
  const stops = routeStops(route);
  return (
    <View>
      {stops.map((stop, i) => (
        <StopRow key={`${stop.role}:${stop.place.kind}:${stop.place.id}`} stop={stop} last={i === stops.length - 1} />
      ))}
    </View>
  );
}

function StopRow({ stop, last }: Readonly<{ stop: Stop; last: boolean }>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  // The navigation app choices open under the place, one place at a time.
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.row} testID={`ride-stop-${stop.role}`}>
      <View style={styles.rail}>
        <Ionicons name={ROLE_ICON[stop.role]} size={iconSize.md} color={colors.primary} />
        {last ? null : <View style={[styles.line, { backgroundColor: colors.primaryLight }]} />}
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>{t(ROLE_LABEL[stop.role])}</Text>
        <View style={styles.placeRow}>
          <Text style={styles.place} numberOfLines={2}>{stop.place.label}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ridePlaces.navigateTo', { place: stop.place.label })}
            testID={`ride-stop-navigate-${stop.role}`}
            onPress={() => setOpen((v) => !v)}
            style={styles.navigate}
          >
            <Ionicons name="navigate-outline" size={iconSize.sm} color={colors.primary} />
            <Text style={styles.navigateText}>{t('ridePlaces.navigate')}</Text>
          </Pressable>
        </View>
        {open ? <NavigationApps place={stop.place} /> : null}
      </View>
    </View>
  );
}

function NavigationApps({ place }: Readonly<{ place: RidePlace }>) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View style={styles.apps}>
      {rideNavigationAppsFor(Platform.OS).map((app) => (
        <Pressable
          key={app}
          accessibilityRole="link"
          testID={`ride-navigate-${app}`}
          style={styles.app}
          // A link that cannot open (no browser at all) has nothing useful to fall back to.
          onPress={() => void Linking.openURL(rideNavigationUrl(app, place)).catch(() => undefined)}
        >
          <Text style={styles.appText}>{t(`ridePlaces.navigationApp.${app}`)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: { flexDirection: rowDirectionStart, gap: spacing.md },
  rail: { alignItems: 'center' as const, width: spacing.lg },
  line: { width: 2, flex: 1, minHeight: spacing.lg, marginVertical: spacing.xs },
  body: { flex: 1, paddingBottom: spacing.md, gap: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  placeRow: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.sm },
  place: { ...typography.h4, color: colors.textPrimary, textAlign: rtlTextAlignStart, flex: 1 },
  navigate: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.xs, padding: spacing.xs },
  navigateText: { ...typography.label, color: colors.primary },
  apps: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.sm },
  app: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  appText: { ...typography.label, color: colors.textPrimary },
}));
