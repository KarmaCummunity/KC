// FR-FIN-003 — one financial account with its computed balance.
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { FinanceAccount } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { Chip } from '../../ui/Chip';
import { GhostButton, PrimaryButton } from '../../ui/Buttons';
import { formatMoney } from '../../../lib/formatMoney';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface FinanceAccountCardProps {
  readonly account: FinanceAccount;
  readonly onEdit: () => void;
  readonly onToggleActive: () => void;
}

function FinanceAccountCardInner({ account, onEdit, onToggleActive }: FinanceAccountCardProps) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.money.accounts;
  return (
    <View style={[styles.card, !account.isActive && styles.inactive]}>
      <View style={styles.head}>
        <View style={styles.titleBlock}>
          <Text style={styles.name}>{account.name}</Text>
          <Text style={styles.meta}>
            {t.kind[account.kind]}
            {account.last4 ? ` · ${t.last4(account.last4)}` : ''}
            {` · ${t.entries(account.entryCount)}`}
          </Text>
        </View>
        <Chip variant="tag" tone="neutral" label={t.kind[account.kind]} size="sm" />
      </View>
      <Text style={styles.balanceLabel}>{t.balance}</Text>
      <Text style={[styles.balance, account.balanceCents >= 0 ? styles.positive : styles.negative]}>
        {formatMoney(account.balanceCents)}
      </Text>
      <View style={styles.actions}>
        <PrimaryButton label={t.edit} size="sm" onPress={onEdit} />
        <GhostButton label={account.isActive ? t.deactivate : t.activate} size="sm" onPress={onToggleActive} />
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    marginHorizontal: spacing.base, marginBottom: spacing.sm, padding: spacing.md, gap: spacing.xs,
    borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  inactive: { opacity: 0.6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  titleBlock: { flex: 1, gap: spacing.xs },
  name: { ...typography.h4, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
  balanceLabel: { ...typography.caption, color: colors.textSecondary },
  balance: { ...typography.h3, ...typography.bold },
  positive: { color: colors.success },
  negative: { color: colors.error },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
}));

export const FinanceAccountCard = memo(FinanceAccountCardInner);
