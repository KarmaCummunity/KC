// V2-ADMIN-MONEY-9 — single ledger entry card.
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { isFinanceCategoryKey, type FinanceEntry } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { Chip } from '../../ui/Chip';
import { AdminCardActions } from '../AdminCardActions';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface FinanceEntryCardProps {
  readonly entry: FinanceEntry;
  /** Resolved name of `entry.accountId`, when known. */
  readonly accountName?: string | null;
  /** Edit and void; both omitted for a viewer who only reads the books. */
  readonly onEdit?: () => void;
  readonly onDelete?: () => void;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function fmtAmount(cents: number, currency: string): string {
  const major = cents / 100;
  try {
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

function FinanceEntryCardInner({ entry, accountName, onEdit, onDelete }: FinanceEntryCardProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.money;
  const sign = entry.direction === 'in' ? '+' : '-';
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <Text style={[styles.amount, entry.direction === 'in' ? styles.amountIn : styles.amountOut]}>
            {sign}{fmtAmount(entry.amountCents, entry.currency)}
          </Text>
          <Text style={styles.meta}>{t.row.occurredAt(fmtDate(entry.occurredAt))}</Text>
        </View>
        <View style={styles.headRight}>
          <Chip variant="tag" tone="neutral" label={t.kind[entry.kind]} size="sm" />
          <Chip
            variant="tag"
            tone={entry.status === 'cleared' ? 'success' : entry.status === 'pending' ? 'warning' : 'muted'}
            label={t.status[entry.status]}
            size="sm"
          />
          {!entry.isPublic && <Chip variant="tag" tone="muted" label={t.row.notPublicChip} size="sm" />}
        </View>
      </View>
      {entry.counterparty && (
        <Text style={styles.metaText}>{t.row.counterpartyPrefix} {entry.counterparty}</Text>
      )}
      {accountName && (
        <Text style={styles.metaText}>{t.row.accountPrefix} {accountName}</Text>
      )}
      {entry.category && (
        <Text style={styles.metaText}>
          {t.row.categoryPrefix}{' '}
          {isFinanceCategoryKey(entry.category) ? L.transparency.category[entry.category] : entry.category}
        </Text>
      )}
      {entry.description && (
        <Text style={styles.description} numberOfLines={3}>{entry.description}</Text>
      )}
      {onEdit && onDelete && (
        <AdminCardActions
          editLabel={t.row.edit}
          deleteLabel={t.row.delete}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    margin: spacing.md, padding: spacing.md, gap: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  head:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headLeft:    { gap: spacing.xs },
  headRight:   { gap: spacing.xs, alignItems: 'flex-end' },
  amount:      { ...typography.bodyLarge, ...typography.bold },
  amountIn:    { color: colors.success },
  amountOut:   { color: colors.error },
  meta:        { ...typography.caption, color: colors.textSecondary },
  metaText:    { ...typography.bodySmall, color: colors.textSecondary },
  description: { ...typography.bodySmall, color: colors.textPrimary, marginTop: spacing.xs },
}));

export const FinanceEntryCard = memo(FinanceEntryCardInner);
