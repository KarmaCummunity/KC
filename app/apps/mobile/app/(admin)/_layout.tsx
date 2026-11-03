// app/apps/mobile/app/(admin)/_layout.tsx
// Admin Portal shell (FR-ADMIN-011 AC1): branded sidebar on web ≥ md, and a
// horizontal pill bar on phone / mobile-web. AdminNav is lazy-loaded to shrink
// initial bundle for non-admin sessions.
import React, { Suspense, lazy, type ReactElement } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaView, StyleSheet, View } from 'react-native';
import { spacing, useBreakpoint, useTheme } from '@kc/ui';
import { AdminGate } from '../../src/components/admin/AdminGate';
import { rowDirectionStart } from '../../src/lib/rtlLayout';
import { SimpleRowListSkeleton } from '../../src/components/skeletons/SimpleRowListSkeleton';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

const AdminNav = lazy(async () => {
  const mod = await import('../../src/components/admin/AdminNav');
  return { default: mod.AdminNav };
});

function AdminNavFallback() {
  return (
    <View style={{ padding: spacing.base, minWidth: 120 }}>
      <SimpleRowListSkeleton rows={4} rowHeight={40} />
    </View>
  );
}

export default function AdminLayout(): ReactElement {
  const breakpoint = useBreakpoint();
  const { colors } = useTheme();
  const isWide = breakpoint !== 'mobile';
  const bg = { backgroundColor: colors.background };
  const stackOptions = { headerShown: false, contentStyle: bg } as const;

  return (
    <AdminGate>
      <SafeAreaView style={[styles.safe, bg]}>
        {isWide ? (
          <View style={styles.row}>
            <View style={styles.main}>
              <Stack screenOptions={stackOptions} />
            </View>
            <Suspense fallback={<AdminNavFallback />}>
              <AdminNav variant="sidebar" />
            </Suspense>
          </View>
        ) : (
          <View style={styles.col}>
            <Suspense fallback={<AdminNavFallback />}>
              <AdminNav variant="topbar" />
            </Suspense>
            <View style={styles.main}>
              <Stack screenOptions={stackOptions} />
            </View>
          </View>
        )}
      </SafeAreaView>
    </AdminGate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  row: { flex: 1, flexDirection: rowDirectionStart },
  col: { flex: 1 },
  main: { flex: 1, minWidth: 0 },
});
