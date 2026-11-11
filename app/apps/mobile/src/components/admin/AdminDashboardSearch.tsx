// app/apps/mobile/src/components/admin/AdminDashboardSearch.tsx
// Mapped to spec: FR-ADMIN-011 / #2081 — search bar on the admin portal home. Typing lists the
// screens the admin may open (title in either language, or a keyword); tapping one navigates there.
import React, { useMemo, useState, type ReactElement } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { AdminRole } from '@kc/domain';
import { iconSize, makeUseStyles, radius, spacing, Text, typography, useTheme } from '@kc/ui';
import { FilterSearchBar } from '../filterKit/FilterSearchBar';
import { rowDirectionStart, textAlignStart } from '../../lib/rtlLayout';
import { ADMIN_DESTINATIONS } from '../../lib/admin/adminDestinations';
import { searchAdminDestinations, visibleDestinations } from '../../lib/admin/adminSearch';
import { bothLocaleBundles, useLocaleBundle } from '../../i18n/useLocaleBundle';

interface Props {
  readonly roles: readonly AdminRole[];
  /** False for the launch surfaces that are hidden (e.g. the WhatsApp bot) — never offered as a result. */
  readonly isHidden?: (key: string) => boolean;
}

// Both languages are searchable whatever the UI language is.
const SEARCH_LABELS = { he: bothLocaleBundles().he.admin, en: bothLocaleBundles().en.admin };

export function AdminDashboardSearch({ roles, isHidden }: Props): ReactElement {
  const L = useLocaleBundle();
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const allowed = visibleDestinations(ADMIN_DESTINATIONS, roles).filter((d) => !isHidden?.(d.key));
    return searchAdminDestinations(query, allowed, SEARCH_LABELS);
  }, [query, roles, isHidden]);
  const searching = query.trim().length > 0;

  return (
    <View style={styles.wrap} testID="admin-dashboard-search">
      <FilterSearchBar
        testID="admin-dashboard-search-input"
        value={query}
        onChangeText={setQuery}
        placeholder={L.admin.dashboard.searchPlaceholder}
      />
      {searching && results.length === 0 ? (
        <Text style={styles.empty} testID="admin-dashboard-search-empty">
          {L.admin.dashboard.searchEmpty}
        </Text>
      ) : null}
      {results.map((d) => (
        <Pressable
          key={d.key}
          testID={`admin-search-result-${d.key}`}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => {
            setQuery('');
            router.push(d.href);
          }}
          accessibilityRole="link"
          accessibilityLabel={L.admin.nav[d.key]}
        >
          <Ionicons name={d.icon} size={iconSize.md} color={colors.primary} />
          <Text style={styles.rowText}>{L.admin.nav[d.key]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.xs },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: textAlignStart(), paddingVertical: spacing.sm },
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: { opacity: 0.7 },
  rowText: { ...typography.button, color: colors.textPrimary, flex: 1, textAlign: textAlignStart() },
}));
