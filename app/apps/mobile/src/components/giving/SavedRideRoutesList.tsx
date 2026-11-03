// "My routes": the routes the user follows, each removable (D74; gap G48). Hidden when empty.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { RideSavedRoute } from '@kc/domain';
import { MY_RIDE_ROUTES_QUERY_KEY, rideSavedRoutesUseCases } from '../../services/rideSavedRoutesComposition';
import { useAuthStore } from '../../store/authStore';

export function SavedRideRoutesList() {
  const { t } = useTranslation();
  const styles = useStyles();
  const qc = useQueryClient();
  const signedIn = useAuthStore((s) => Boolean(s.session?.userId));
  const routes = useQuery({
    queryKey: MY_RIDE_ROUTES_QUERY_KEY,
    queryFn: () => rideSavedRoutesUseCases.listMine().execute(),
    enabled: signedIn,
  });

  const remove = async (id: string) => {
    try {
      await rideSavedRoutesUseCases.remove().execute(id);
      await qc.invalidateQueries({ queryKey: MY_RIDE_ROUTES_QUERY_KEY });
    } catch {
      alert(t('rideRoutes.removeError'));
    }
  };

  const list = routes.data ?? [];
  if (list.length === 0) return null;

  return (
    <View style={styles.box} testID="saved-ride-routes">
      <Text style={styles.title}>{t('rideRoutes.mine')}</Text>
      {list.map((r) => (
        <View key={r.id} style={styles.row}>
          <Text style={styles.route}>{describe(r, t)}</Text>
          <Pressable accessibilityRole="button" testID={`saved-ride-route-remove-${r.id}`} onPress={() => void remove(r.id)}>
            <Text style={styles.remove}>{t('rideRoutes.remove')}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/** "Tel Aviv → Haifa · offers · Sun, Thu · morning" — only the filters the route has. */
function describe(r: RideSavedRoute, t: (key: string) => string): string {
  return [
    `${r.origin.label} → ${r.dest.label}`,
    t(`rideRoutes.wants.${r.wants}`),
    r.weekdays ? r.weekdays.map((d) => t(`rideRoutes.weekday.${d}`)).join(', ') : null,
    r.timeWindow ? t(`rideRoutes.window.${r.timeWindow}`) : null,
  ].filter(Boolean).join(' · ');
}

const useStyles = makeUseStyles(({ colors }) => ({
  box: { gap: spacing.xs, marginTop: spacing.sm },
  title: { ...typography.label, color: colors.textSecondary },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: spacing.sm },
  route: { ...typography.body, color: colors.textPrimary, flex: 1 },
  remove: { ...typography.caption, color: colors.error },
}));
