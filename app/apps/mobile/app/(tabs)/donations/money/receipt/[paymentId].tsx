import React from 'react';
import { ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../../src/components/ui/Screen';
import { paymentsUseCases } from '../../../../../src/services/paymentsComposition';
import { shekelsText } from '../../../../../src/components/money/moneyAmount';
import { valueOrNull } from '../../../../../src/lib/backendAvailability';

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.h2, color: colors.textPrimary },
  line: { ...typography.body, color: colors.textSecondary },
  serial: { ...typography.bodyLarge, color: colors.primary, ...typography.bold },
}));

export default function DonationReceiptScreen() {
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const { t } = useTranslation();
  const styles = useStyles();
  const receipt = useQuery({
    queryKey: ['money', 'receipt', paymentId],
    queryFn: () => valueOrNull(() => paymentsUseCases.getReceipt().execute(paymentId!)),
    enabled: Boolean(paymentId),
  });

  const r = receipt.data;
  if (receipt.isLoading) {
    return (
      <Screen>
        <Text style={{ padding: spacing.lg }}>{t('moneyPayments.loading')}</Text>
      </Screen>
    );
  }
  if (!r) {
    return (
      <Screen>
        <Text style={{ padding: spacing.lg }}>{t('moneyPayments.receiptNotFound')}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{t('moneyPayments.receiptHeading')}</Text>
        <Text style={styles.line}>{r.orgName}</Text>
        <Text style={styles.line}>{t('moneyPayments.receiptAmount', { amount: shekelsText(r.amountAgorot) })}</Text>
        <Text style={styles.line}>{new Date(r.issuedAt).toLocaleString()}</Text>
        {r.sec46Eligible ? (
          <>
            <Text style={styles.line}>{t('moneyPayments.section46Label')}</Text>
            <Text style={styles.serial}>{r.serial}</Text>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
