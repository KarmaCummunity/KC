// FR-POST-021 — partner-surface identity mask (shared: create, edit, post menu).
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, PlatformSwitch, radius, spacing, typography, Text } from '@kc/ui';
import {
  layoutDirectionStyle,
  layoutWritingDirectionStyle,
  textAlignStart,
} from '../../lib/rtlLayout';

interface Props {
  readonly value: boolean;
  readonly onChange: (next: boolean) => void;
  readonly disabled?: boolean;
}

export function CounterpartyIdentityCard({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const styles = useCounterpartyIdentityCardStyles();

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('post.createCounterpartyPrivacyTitle')}</Text>
      <View style={styles.row}>
        <Text style={styles.label}>{t('post.counterpartyMaskLabel')}</Text>
        <PlatformSwitch value={value} onValueChange={onChange} disabled={disabled} />
      </View>
      <Text style={styles.hint}>{t('post.createCounterpartyPrivacyHint')}</Text>
    </View>
  );
}

const useCounterpartyIdentityCardStyles = makeUseStyles(({ colors }) => ({
  card: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...layoutDirectionStyle(),
  },
  title: {
    ...typography.caption,
    ...typography.semiBold,
    color: colors.textSecondary,
    textAlign: textAlignStart(),
    ...layoutWritingDirectionStyle(),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...typography.caption,
    flex: 1,
    color: colors.textPrimary,
    textAlign: textAlignStart(),
    ...layoutWritingDirectionStyle(),
  },
  hint: {
    ...typography.caption,
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: textAlignStart(),
    lineHeight: 16,
    ...layoutWritingDirectionStyle(),
  },
}));
