// app/apps/mobile/src/components/admin/admins/ManagerSummary.tsx
// FR-ADMIN-025 — read-only display of a grant's direct manager + subordinates
// (+ any mutation error). Presentational; mutation lives in GrantManagerSection.
import { View } from 'react-native';
import type { OrgTreeMember } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle, type LocaleBundle } from '../../../i18n/useLocaleBundle';

export interface ManagerSummaryProps {
  readonly managerName: string | null;
  readonly subordinates: readonly OrgTreeMember[];
  readonly errCode: string | null;
}

function errorText(L: LocaleBundle, code: string): string {
  const map = L.admin.admins.managerErrors;
  return map[code as keyof LocaleBundle['admin']['admins']['managerErrors']] ?? map.unknown;
}

export function ManagerSummary({ managerName, subordinates, errCode }: ManagerSummaryProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const unnamed = L.admin.admins.row.unnamed;
  return (
    <View>
      <Text style={styles.label}>{L.admin.admins.detail.managerSection}</Text>
      <Text style={styles.value}>{managerName ?? L.admin.admins.detail.managerNone}</Text>

      <Text style={styles.label}>{L.admin.admins.detail.subordinatesSection}</Text>
      {subordinates.length === 0 ? (
        <Text style={styles.value}>{L.admin.admins.detail.subordinatesNone}</Text>
      ) : (
        subordinates.map((s) => (
          <Text key={s.grantId} style={styles.value}>• {s.displayName ?? unnamed}</Text>
        ))
      )}

      {errCode !== null && <Text style={styles.error}>{errorText(L, errCode)}</Text>}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  label: { fontSize: typography.bodySmall.fontSize, ...typography.extraBold, color: colors.textSecondary, marginTop: spacing.xs, textAlign: textAlignStart() },
  value: { fontSize: typography.body.fontSize, color: colors.textPrimary, textAlign: textAlignStart() },
  error: { fontSize: typography.bodySmall.fontSize, color: colors.error, marginTop: spacing.xs, textAlign: textAlignStart() },
}));
