// app/apps/mobile/app/(admin)/money/visibility.tsx
// FR-FIN-022 — what the public sees of the organization's finances. Everything is off by default;
// only a super admin can change it. The preview below is the exact public component.
import React from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TRANSPARENCY_TOGGLES, hasAnyTransparencyToggle, isFinanceLedgerError,
  type TransparencySettings, type TransparencyToggle,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { useMoneyPermissions } from '../../../src/hooks/useMoneyPermissions';
import { container } from '../../../src/lib/container';
import { AdminScreenGuard } from '../../../src/components/admin/AdminScreenGuard';
import { MoneySubNav } from '../../../src/components/admin/money/MoneySubNav';
import { alertError } from '../../../src/components/admin/money/alertError';
import { OrgTransparencySection } from '../../../src/components/finance/OrgTransparencySection';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const SETTINGS_KEY = ['admin.money.transparency-settings'] as const;

export default function MoneyVisibilityScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.money;
  const v = t.visibility;
  const { isLoading: rolesLoading, canView: allowed, canTransparency: canChange } = useMoneyPermissions();
  // canChange mirrors finance_transparency_settings_set (platform admins and org admins), so no
  // switch is shown live that the server would refuse.
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => container.getTransparencySettings.execute(),
    enabled: allowed,
  });

  const toggle = useMutation({
    mutationFn: (patch: Partial<Record<TransparencyToggle, boolean>>) =>
      container.setTransparencySettings.execute(patch),
    onSuccess: (next: TransparencySettings) => {
      queryClient.setQueryData(SETTINGS_KEY, next);
      // The public card (About / statistics / preview below) must reflect the change at once.
      void queryClient.invalidateQueries({ queryKey: ['org-transparency'] });
    },
    onError: (err) => alertError(isFinanceLedgerError(err) ? err.code : 'unknown', t.errors),
  });

  return (
    <AdminScreenGuard isLoading={rolesLoading} allowed={allowed} loadingLabel={t.loading} forbiddenLabel={t.forbiddenTitle}>
      <View style={styles.root}>
        <MoneySubNav active="visibility" />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.hint}>{v.intro}</Text>
          {!canChange && <Text style={styles.warn}>{v.readOnly}</Text>}

          <View style={styles.card}>
            {TRANSPARENCY_TOGGLES.map((key) => (
              <View key={key} style={styles.toggleRow}>
                <View style={styles.toggleText}>
                  <Text style={styles.toggleTitle}>{v.toggles[key].title}</Text>
                  <Text style={styles.toggleHint}>{v.toggles[key].hint}</Text>
                </View>
                <Switch
                  value={settings.data?.[key] ?? false}
                  disabled={!canChange || settings.isLoading || toggle.isPending}
                  onValueChange={(value) => toggle.mutate({ [key]: value })}
                  accessibilityLabel={v.toggles[key].title}
                />
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>{v.previewTitle}</Text>
          {settings.data && !hasAnyTransparencyToggle(settings.data) && (
            <Text style={styles.hint}>{v.previewOff}</Text>
          )}
          <OrgTransparencySection />
        </ScrollView>
      </View>
    </AdminScreenGuard>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.md, paddingBottom: spacing['3xl'] },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
  warn: { ...typography.bodySmall, color: colors.warning },
  card: {
    borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  toggleText: { flex: 1, gap: spacing.xs },
  toggleTitle: { ...typography.body, ...typography.semiBold, color: colors.textPrimary },
  toggleHint: { ...typography.caption, color: colors.textSecondary },
  sectionTitle: { ...typography.h4, color: colors.textPrimary },
}));
