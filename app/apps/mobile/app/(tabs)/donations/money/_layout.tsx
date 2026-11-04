import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { nestedStackGestureOptions } from '../../../../src/navigation/nestedStackGestureOptions';
import { topBarStackHeaderOptions } from '../../../../src/navigation/TopBarStackHeader';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function MoneyLayout() {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{ ...nestedStackGestureOptions,
        ...topBarStackHeaderOptions,
        headerBackTitle: t('general.back'),
      }}
    >
      <Stack.Screen name="index" options={{ headerTitle: t('donations.moneyScreen.title') }} />
      <Stack.Screen name="nonprofit/[slug]" options={{ headerTitle: t('moneyPayments.nonprofitTitle') }} />
      <Stack.Screen name="donate/[orgId]" options={{ headerTitle: t('moneyPayments.donateTitle') }} />
      <Stack.Screen name="standing-order/[orgId]" options={{ headerTitle: t('moneyPayments.standingTitle') }} />
      <Stack.Screen name="history" options={{ headerTitle: t('moneyPayments.historyTitle') }} />
      <Stack.Screen name="receipt/[paymentId]" options={{ headerTitle: t('moneyPayments.receiptTitle') }} />
      <Stack.Screen name="standing-orders" options={{ headerTitle: t('moneyPayments.myStandingTitle') }} />
    </Stack>
  );
}
