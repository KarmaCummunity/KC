// Ride detail hero: the route's places in order (each with "navigate"), the route on a map,
// and departure and seats (docs/spec/05_giving_worlds.md §5.3, D71, D72).
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, shadow, spacing, typography, useTheme, Text } from '@kc/ui';
import { readRideRoute, readRideSeriesMarker, type RideHouseNumbers } from '@kc/domain';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { formatRideTime } from '../cards/ListingCard';
import { RideRouteMap } from './RideRouteMap';
import { RideRouteStops } from './RideRouteStops';
import { Chip } from '../ui/Chip';
import { rideSeatCountKey } from '../../lib/rideSeatCountKey';
import { rideSeriesLabel } from '../../lib/rides/rideSeriesLabel';

interface Props {
  details: Record<string, unknown>;
  direction: 'give' | 'request';
  /** Private house numbers the viewer may see (FR-RIDE-003 AC9). */
  houseNumbers?: RideHouseNumbers;
  /** Nested inside the post content card — no second outer frame. */
  embedded?: boolean;
}

type InfoChip = { icon: React.ComponentProps<typeof Ionicons>['name']; text: string };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function RideRouteCard({ details, direction, houseNumbers, embedded = false }: Readonly<Props>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const route = readRideRoute(details);
  const when = formatRideTime(str(details['departs_at']));
  const seats = num(details['seats_available']) ?? num(details['passengers']);
  const series = readRideSeriesMarker(details);

  const chips: InfoChip[] = [];
  if (when) chips.push({ icon: 'time-outline', text: when });
  // An occurrence of a recurring ride says when it repeats (FR-RIDE-046).
  if (series) chips.push({ icon: 'repeat-outline', text: rideSeriesLabel(series, t) });
  if (seats != null) chips.push({ icon: 'people-outline', text: t(rideSeatCountKey(direction === 'request' ? 'passengers' : 'seats', seats), { count: seats }) });
  // Rides are free for now (spec 05 §5.3): no cost chip, even on older rides that carry an amount.

  return (
    <View
      style={[styles.card, embedded ? styles.cardEmbedded : styles.cardStandalone]}
      testID="ride-route-card"
    >
      <View style={styles.badgeRow}>
        <Ionicons name="car" size={iconSize.md} color={colors.primary} />
        <Text style={styles.badge}>{t(direction === 'request' ? 'cards.rideRequest' : 'cards.rideOffer')}</Text>
      </View>
      <RideRouteStops route={route} houseNumbers={houseNumbers} />
      <RideRouteMap route={route} />
      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((c) => (
            <Chip key={c.text} variant="tag" size="sm" icon={c.icon} label={c.text} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  card: { gap: spacing.sm },
  cardStandalone: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
    gap: spacing.md,
    ...shadow.card,
  },
  cardEmbedded: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: isDark ? colors.surfaceRaised : colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  badgeRow: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.xs },
  badge: { ...typography.label, color: colors.primary, fontWeight: '600' as const },
  chips: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.xs },
}));
