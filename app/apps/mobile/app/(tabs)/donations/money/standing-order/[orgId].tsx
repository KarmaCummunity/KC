import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AmountCheckoutScreen } from '../../../../../src/components/money/AmountCheckoutForm';
import { newIdempotencyKey, paymentsUseCases } from '../../../../../src/services/paymentsComposition';
import { toAgorot } from '../../../../../src/components/money/moneyAmount';

export default function StandingOrderScreen() {
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { t } = useTranslation();
  const router = useRouter();

  const createStandingOrder = async (shekels: number) => {
    await paymentsUseCases.createStandingOrder().execute({
      orgId: orgId!,
      amountAgorot: toAgorot(shekels),
      idempotencyKey: newIdempotencyKey('standing'),
    });
    router.replace('/(tabs)/donations/money/standing-orders');
  };

  return (
    <AmountCheckoutScreen
      kind="standing-order"
      orgId={orgId}
      intro={t('moneyPayments.standingIntro')}
      amountLabel={t('moneyPayments.monthlyAmount')}
      initialAmount="36"
      submitLabel={t('moneyPayments.createStanding')}
      onSubmit={createStandingOrder}
    />
  );
}
