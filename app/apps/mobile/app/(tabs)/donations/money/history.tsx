import React from 'react';
import { Pressable } from 'react-native';
import { KcFlashList } from '../../../../src/components/lists/KcFlashList';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../src/components/ui/Screen';
import { paymentsUseCases } from '../../../../src/services/paymentsComposition';

const useStyles = makeUseStyles(({ colors }) => ({
  row: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { ...typography.bodyLarge, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
}));

export default function DonationHistoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const history = useQuery({
    queryKey: ['money', 'history'],
    queryFn: () => paymentsUseCases.listHistory().execute(50),
  });

  return (
    <Screen>
      <KcFlashList
        data={history.data ?? []}
        keyExtractor={(item) => item.paymentId}
        ListEmptyComponent={
          <Text style={{ padding: spacing.lg, textAlign: 'center' }}>
            {history.isLoading ? t('moneyPayments.loading') : t('moneyPayments.historyEmpty')}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/donations/money/receipt/[paymentId]',
                params: { paymentId: item.paymentId },
              })
            }
          >
            <Text style={styles.title}>
              ₪{item.amountIls.toFixed(0)} · {item.orgName}
            </Text>
            <Text style={styles.meta}>
              {new Date(item.paidAt).toLocaleString()}
              {item.section46Serial ? ` · ${item.section46Serial}` : ''}
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}
