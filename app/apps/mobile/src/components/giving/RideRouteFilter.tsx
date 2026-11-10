// Rides hub route filter (#1626; D71 official places, D74 saved routes): a collapsed row on top
// of the feed. Opened, it picks origin / destination; with both picked the feed below shows
// the ride offers along that route. The chosen route stays visible (with "clear") when closed.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, iconSize, useTheme, Text } from '@kc/ui';
import type { RidePlace } from '@kc/domain';
import { RidePlaceField } from './RidePlaceField';
import { RideRouteFollow } from './RideRouteFollow';
import { SavedRideRoutesList } from './SavedRideRoutesList';
import { GhostButton } from '../ui/Buttons';
import { useRidePlaces } from '../../hooks/useRidePlaces';
import { useAuthStore } from '../../store/authStore';
import { hapticLightTap } from '../../lib/haptics';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import type { RidesHubFeedState } from '../../hooks/useRidesHubFeed';

type RouteFilterState = Pick<
  RidesHubFeedState,
  'origin' | 'setOrigin' | 'dest' | 'setDest' | 'routeActive' | 'clearRoute'
>;

const useStyles = makeUseStyles(({ colors }) => ({
  root: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  toggle: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: rtlTextAlignStart },
  panel: { gap: spacing.sm },
}));

export function RideRouteFilter({ filter }: Readonly<{ filter: RouteFilterState }>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const places = useRidePlaces();
  const signedIn = useAuthStore((s) => Boolean(s.session?.userId));
  const [open, setOpen] = useState(false);
  const { origin, dest } = filter;

  const field = {
    places: places.data ?? null,
    isLoading: places.isLoading,
    error: places.error,
    onRetry: () => void places.refetch(),
  };
  const pick = (set: (place: RidePlace) => void) => (place: RidePlace) => {
    hapticLightTap();
    set(place);
  };
  // Closed with a route chosen, the row names it so the narrowed feed is never a surprise.
  const toggleLabel =
    filter.routeActive && origin && dest
      ? t('rideFeed.routeFilterActive', { from: origin.label, to: dest.label })
      : t('rideFeed.routeFilterTitle');

  return (
    <View style={styles.root}>
      <Pressable
        testID="rides-route-filter-toggle"
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={toggleLabel}
        style={styles.toggle}
      >
        <Ionicons name="navigate-outline" size={iconSize.md} color={colors.primary} />
        <Text style={styles.toggleText} numberOfLines={1}>{toggleLabel}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={iconSize.md} color={colors.textSecondary} />
      </Pressable>
      {filter.routeActive ? (
        <GhostButton
          testID="rides-route-filter-clear"
          size="sm"
          label={t('rideFeed.routeFilterClear')}
          onPress={filter.clearRoute}
        />
      ) : null}
      {open ? (
        <View style={styles.panel} testID="rides-route-filter-panel">
          <RidePlaceField label={t('ridePlaces.fieldOrigin')} value={origin} onChange={pick(filter.setOrigin)} {...field} />
          <RidePlaceField label={t('ridePlaces.fieldDest')} value={dest} onChange={pick(filter.setDest)} {...field} />
          {origin && dest && signedIn ? (
            <RideRouteFollow key={`${origin.kind}:${origin.id}>${dest.kind}:${dest.id}`} origin={origin} dest={dest} />
          ) : null}
          <SavedRideRoutesList />
        </View>
      ) : null}
    </View>
  );
}
